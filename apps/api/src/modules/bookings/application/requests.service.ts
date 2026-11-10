import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  FeatureFlag,
  MAX_OPEN_REQUESTS_PER_CUSTOMER,
  MAX_QUOTE_LINE_ITEMS,
  QuoteStatus,
  RideRequestStatus,
  TripType,
  type Booking,
  type CreateRideRequest,
  type DriverRequestFeedItem,
  type PageQuery,
  type Paginated,
  type Quote,
  type RideRequest,
  type RideRequestListQuery,
  type SubmitQuoteRequest,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db, json } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { roundKm } from '../../../common/geo.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { inr, iso, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { ENTITLEMENTS, type EntitlementsPort } from '../../../common/ports.js';
import { bookingFeeFor } from '../../billing/domain/billing-rules.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import { firstName } from '../../identity/domain/auth-rules.js';
import {
  MarketplaceFacade,
  PartnerOperations,
  type DriverCard,
  type DriverMatchCriteria,
  type VehicleCard,
} from '../../marketplace/application/marketplace.facade.js';
import type { DriverProfileRow } from '../../marketplace/infrastructure/rows.js';
import { SettingsService } from '../../platform/application/settings.service.js';
import { PromotionsService } from '../../promotions/application/promotions.service.js';
import {
  bookingCode,
  cancellationPolicyFor,
  quoteFareBounds,
  requestExpiry,
  validateRideRequest,
} from '../domain/booking-rules.js';
import type { BookingRow, QuoteRow, RideRequestRow } from '../infrastructure/rows.js';
import { BookingsService } from './bookings.service.js';
import {
  BookingEvents,
  type QuoteAcceptedEvent,
  type QuoteSubmittedEvent,
  type RequestCreatedEvent,
  type RequestExpiredEvent,
} from './events.js';

/** A driver with a fresh position also sees requests whose pickup is this close, outside their listed areas. */
const NEARBY_PICKUP_METERS = 15_000;

interface FeedRow extends RideRequestRow {
  customer_name: string | null;
  competing: number;
  distance_m: number | null;
}

/**
 * Ride requests and quotations: the customer asks, matching partners answer
 * with a price, and the customer picks one - at which point a booking exists.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly catalog: CatalogService,
    private readonly marketplace: MarketplaceFacade,
    private readonly partnerOps: PartnerOperations,
    private readonly promotions: PromotionsService,
    private readonly settings: SettingsService,
    private readonly bookings: BookingsService,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementsPort,
  ) {}

  // =====================================================================================
  // Customer side
  // =====================================================================================

  async create(user: AuthUser, input: CreateRideRequest): Promise<RideRequest> {
    if (input.tripType === TripType.Outstation) await this.settings.requireFeature(FeatureFlag.Outstation);
    if (input.tripType === TripType.Sightseeing && input.packageId) await this.settings.requireFeature(FeatureFlag.Packages);

    const category = await this.catalog.requireActiveCategory(input.categoryCode);
    const now = new Date();
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const returnAt = input.returnAt ? new Date(input.returnAt) : null;
    const errors = validateRideRequest(
      {
        tripType: input.tripType,
        hasDrop: !!input.drop,
        hasPackage: !!input.packageId,
        scheduledAt,
        returnAt,
        passengers: input.passengers,
        luggage: input.luggage ?? 0,
        categorySeats: category.seats,
        categoryLuggage: category.luggage_capacity,
      },
      now,
    );
    if (errors.length > 0) throw AppError.validation(errors);

    const regionSlug = await this.catalog.regionSlugAt(input.pickup.location);
    if (!regionSlug || !(await this.catalog.isLive(regionSlug))) {
      throw AppError.unprocessable(
        ErrorCode.OutsideServiceArea,
        regionSlug ? 'Payana is not live in this area yet.' : 'This pickup point is outside the areas Payana serves.',
      );
    }

    let packageTitle: string | null = null;
    if (input.packageId) {
      const pkg = await this.promotions.findActivePackage(input.packageId);
      if (!pkg) throw AppError.invalid('packageId', 'This package is no longer available.');
      packageTitle = pkg.title;
    }
    if (input.targetDriverId && !(await this.marketplace.isBookable(input.targetDriverId))) {
      throw AppError.invalid('targetDriverId', 'This driver is not taking requests at the moment.');
    }

    const estimate = input.drop
      ? await this.catalog.fareEstimate(input.pickup.location, input.drop.location, category.code)
      : null;
    const eligible = await this.marketplace.eligibleDrivers({
      categoryCode: category.code,
      regionSlug,
      targetDriverId: input.targetDriverId ?? null,
      onlineOnly: input.tripType === TripType.Immediate,
      minSeats: input.passengers,
    });
    // A partner is never offered their own request.
    const offered = eligible.filter((d) => d.userId !== user.id);

    const row = await this.db.tx(async () => {
      // Serialise this customer's creates so the open-request cap cannot be raced.
      await this.db.one(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
      const open = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM ride_requests WHERE customer_id = $1 AND status = 'open' AND expires_at > now()`,
        [user.id],
      );
      if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS_PER_CUSTOMER) {
        throw AppError.conflict(
          `You already have ${MAX_OPEN_REQUESTS_PER_CUSTOMER} open requests. Choose a quote or cancel one before asking again.`,
        );
      }
      const created = await this.db.insert<RideRequestRow>('ride_requests', {
        customer_id: user.id,
        trip_type: input.tripType,
        pickup: json({ ...input.pickup, regionSlug }),
        pickup_lat: input.pickup.location.lat,
        pickup_lng: input.pickup.location.lng,
        drop_place: json(input.drop ?? null),
        region_slug: regionSlug,
        scheduled_at: scheduledAt,
        return_at: returnAt,
        category_code: category.code,
        passengers: input.passengers,
        luggage: input.luggage ?? 0,
        notes: input.notes?.trim() || null,
        package_id: input.packageId ?? null,
        package_title: packageTitle,
        target_driver_id: input.targetDriverId ?? null,
        estimate: json(estimate),
        drivers_notified: offered.length,
        expires_at: requestExpiry(input.tripType, now, scheduledAt),
      });
      await this.outbox.publish(BookingEvents.RequestCreated, {
        requestId: created.id,
        customerId: user.id,
        driverUserIds: offered.map((d) => d.userId),
        pickupLabel: input.pickup.label,
        dropLabel: input.drop?.label ?? packageTitle,
        direct: !!input.targetDriverId,
      } satisfies RequestCreatedEvent);
      return created;
    });
    return this.toRequest(row);
  }

  async get(user: AuthUser, requestId: string): Promise<RideRequest> {
    return this.toRequest(await this.ownRequest(user, requestId));
  }

  async list(user: AuthUser, q: RideRequestListQuery): Promise<Paginated<RideRequest>> {
    await this.expireDue(user.id);
    const w = pageWindow(q);
    const params: unknown[] = [user.id];
    let cond = `customer_id = $1`;
    if (q.status) {
      params.push(q.status);
      cond += ` AND status = $2`;
    }
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ride_requests WHERE ${cond}`, params);
    const rows = await this.db.query<RideRequestRow>(
      `SELECT * FROM ride_requests WHERE ${cond} ORDER BY created_at DESC LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(await this.toRequests(rows), total?.n ?? 0, w);
  }

  async cancel(user: AuthUser, requestId: string): Promise<RideRequest> {
    const row = await this.db.tx(async () => {
      const request = await this.ownRequest(user, requestId, true);
      if (request.status !== RideRequestStatus.Open) {
        throw AppError.conflict('This request is no longer open.', ErrorCode.RequestNotOpen);
      }
      await this.db.exec(`UPDATE quotes SET status = 'closed' WHERE request_id = $1 AND status = 'active'`, [request.id]);
      return (await this.db.update<RideRequestRow>('ride_requests', { id: request.id }, { status: RideRequestStatus.Cancelled }))!;
    });
    return this.toRequest(row);
  }

  /**
   * The customer picks a quote. One transaction: the request row is locked,
   * the chosen quote is accepted, the rest are closed and the booking is
   * created - so two simultaneous accepts can produce only one booking.
   */
  async acceptQuote(user: AuthUser, requestId: string, quoteId: string): Promise<Booking> {
    const bookingId = await this.db.tx(async () => {
      const request = await this.ownRequest(user, requestId, true);
      if (request.status !== RideRequestStatus.Open) {
        throw AppError.conflict('This request is no longer open.', ErrorCode.RequestNotOpen);
      }
      const quote = await this.db.one<QuoteRow>(`SELECT * FROM quotes WHERE id = $1 AND request_id = $2 FOR UPDATE`, [
        quoteId,
        request.id,
      ]);
      if (!quote) throw AppError.notFound('Quote');
      if (quote.status !== QuoteStatus.Active || quote.valid_until.getTime() <= Date.now()) {
        throw AppError.conflict('This quote is no longer available. Choose another one.', ErrorCode.QuoteNotActive);
      }
      const cards = await this.marketplace.driverCards([quote.driver_profile_id]);
      const driver = cards.get(quote.driver_profile_id);
      if (!driver || !(await this.marketplace.isBookable(quote.driver_profile_id))) {
        await this.db.exec(`UPDATE quotes SET status = 'closed' WHERE id = $1`, [quote.id]);
        throw AppError.conflict('This driver can no longer take the trip. Choose another quote.', ErrorCode.QuoteNotActive);
      }

      const settings = await this.settings.get();
      const fee = bookingFeeFor(quote.fare_minor, settings.bookingFee);
      const others = await this.db.query<{ driver_profile_id: string }>(
        `UPDATE quotes SET status = 'closed' WHERE request_id = $1 AND status = 'active' AND id <> $2 RETURNING driver_profile_id`,
        [request.id, quote.id],
      );
      await this.db.exec(`UPDATE quotes SET status = 'accepted' WHERE id = $1`, [quote.id]);

      let booking: BookingRow | null = null;
      for (let attempt = 0; attempt < 5 && !booking; attempt++) {
        const code = bookingCode();
        const clash = await this.db.one(`SELECT 1 FROM bookings WHERE code = $1`, [code]);
        if (clash) continue;
        booking = await this.db.insert<BookingRow>('bookings', {
          code,
          request_id: request.id,
          quote_id: quote.id,
          customer_id: request.customer_id,
          driver_profile_id: quote.driver_profile_id,
          vehicle_id: quote.vehicle_id,
          trip_type: request.trip_type,
          pickup: json(request.pickup),
          drop_place: json(request.drop_place),
          scheduled_at: request.scheduled_at ?? new Date(),
          return_at: request.return_at,
          passengers: request.passengers,
          luggage: request.luggage,
          notes: request.notes,
          package_title: request.package_title,
          quoted_minor: quote.fare_minor,
          booking_fee_minor: fee,
          total_minor: quote.fare_minor + fee,
          inclusions: quote.inclusions,
          exclusions: quote.exclusions,
          pickup_note: quote.pickup_note,
          cancellation_policy: json(cancellationPolicyFor(request.trip_type)),
        });
      }
      if (!booking) throw new Error('Could not allocate a booking code');

      await this.db.insert('booking_events', { booking_id: booking.id, status: booking.status, actor: 'customer' });
      await this.db.exec(`UPDATE ride_requests SET status = 'booked', booking_id = $2 WHERE id = $1`, [request.id, booking.id]);
      await this.marketplace.recordBookingWon(quote.driver_profile_id);

      const otherCards = await this.marketplace.driverCards(others.map((o) => o.driver_profile_id));
      await this.outbox.publish(BookingEvents.QuoteAccepted, {
        bookingId: booking.id,
        bookingCode: booking.code,
        requestId: request.id,
        customerId: request.customer_id,
        driverUserId: driver.userId,
        otherDriverUserIds: [...otherCards.values()].map((c) => c.userId),
      } satisfies QuoteAcceptedEvent);
      await this.audit.record({
        actor: user,
        action: 'booking.created',
        targetType: 'booking',
        targetId: booking.id,
        metadata: { code: booking.code, quotedMinor: quote.fare_minor, bookingFeeMinor: fee },
      });
      return booking.id;
    });
    return this.bookings.getForParty(user, bookingId);
  }

  // =====================================================================================
  // Driver side
  // =====================================================================================

  async feed(user: AuthUser, q: PageQuery): Promise<Paginated<DriverRequestFeedItem>> {
    const profile = await this.marketplace.requireVerifiedProfile(user);
    const criteria = await this.marketplace.matchCriteria(profile);
    const w = pageWindow(q);
    const { sql, params } = this.feedQuery(profile, criteria);
    const rows = await this.db.query<FeedRow & { total: number }>(
      `SELECT *, count(*) OVER()::int AS total FROM (${sql}) f
        ORDER BY (target_driver_id IS NOT NULL) DESC, (trip_type = 'immediate') DESC, created_at DESC
        LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(await this.toFeedItems(rows, profile.id), rows[0]?.total ?? 0, w);
  }

  async feedItem(user: AuthUser, requestId: string): Promise<DriverRequestFeedItem> {
    const profile = await this.marketplace.requireVerifiedProfile(user);
    const row = await this.visibleToDriver(profile, requestId);
    return (await this.toFeedItems([row], profile.id))[0]!;
  }

  async submitQuote(user: AuthUser, requestId: string, input: SubmitQuoteRequest): Promise<Quote> {
    const profile = await this.marketplace.requireVerifiedProfile(user);
    const inclusions = cleanLines(input.inclusions, 'inclusions');
    const exclusions = cleanLines(input.exclusions, 'exclusions');

    const quote = await this.db.tx(async () => {
      const visible = await this.visibleToDriver(profile, requestId);
      const request = (await this.db.one<RideRequestRow>(`SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE`, [visible.id]))!;
      if (request.status !== RideRequestStatus.Open || request.expires_at.getTime() <= Date.now()) {
        throw AppError.conflict('This request is no longer open for quotes.', ErrorCode.RequestNotOpen);
      }
      // Owner or authorised driver, with valid vehicle and personal documents - checked at quote time.
      const vehicle = await this.partnerOps.assertCanOperate(profile, input.vehicleId);
      if (vehicle.category_code !== request.category_code && request.target_driver_id !== profile.id) {
        throw AppError.invalid('vehicleId', 'The customer asked for a different type of vehicle.');
      }
      if (vehicle.seats < request.passengers) {
        throw AppError.invalid('vehicleId', `This vehicle seats ${vehicle.seats}; the request is for ${request.passengers}.`);
      }
      const category = await this.catalog.findCategory(request.category_code);
      const bounds = quoteFareBounds({
        categoryBaseFareMinor: category?.base_fare_minor ?? 0,
        estimateHighMinor: request.estimate?.high.amountMinor ?? null,
        isReturnTrip: request.return_at !== null,
      });
      if (input.fareMinor < bounds.minMinor || input.fareMinor > bounds.maxMinor) {
        throw AppError.invalid(
          'fareMinor',
          `For this trip a quote must be between Rs ${Math.ceil(bounds.minMinor / 100)} and Rs ${Math.floor(bounds.maxMinor / 100)}.`,
        );
      }
      const existing = await this.db.one(
        `SELECT 1 FROM quotes WHERE request_id = $1 AND driver_profile_id = $2 AND status = 'active'`,
        [request.id, profile.id],
      );
      if (existing) throw AppError.conflict('You already have a quote on this request. Withdraw it to send a new one.');
      await this.entitlements.assertCanSendQuote(profile.id);

      const validUntil = new Date(Math.min(Date.now() + input.validForMinutes * 60_000, request.expires_at.getTime()));
      const created = await this.db.insert<QuoteRow>('quotes', {
        request_id: request.id,
        driver_profile_id: profile.id,
        vehicle_id: vehicle.id,
        fare_minor: input.fareMinor,
        inclusions,
        exclusions,
        pickup_note: input.pickupNote?.trim() || null,
        eta_minutes: input.etaMinutes ?? null,
        valid_until: validUntil,
      });
      await this.entitlements.recordQuoteSent(profile.id);
      await this.outbox.publish(BookingEvents.QuoteSubmitted, {
        requestId: request.id,
        customerId: request.customer_id,
        driverName: profile.display_name,
        fareMinor: input.fareMinor,
      } satisfies QuoteSubmittedEvent);
      return created;
    });
    return (await this.toQuotes([quote]))[0]!;
  }

  async withdrawQuote(user: AuthUser, quoteId: string): Promise<Quote> {
    const profile = await this.marketplace.requireVerifiedProfile(user);
    const row = await this.db.tx(async () => {
      const quote = await this.db.one<QuoteRow>(`SELECT * FROM quotes WHERE id = $1 FOR UPDATE`, [quoteId]);
      if (!quote || quote.driver_profile_id !== profile.id) throw AppError.notFound('Quote');
      if (quote.status !== QuoteStatus.Active) {
        throw AppError.conflict('Only an active quote can be withdrawn.', ErrorCode.QuoteNotActive);
      }
      return (await this.db.update<QuoteRow>('quotes', { id: quote.id }, { status: QuoteStatus.Withdrawn }))!;
    });
    return (await this.toQuotes([row]))[0]!;
  }

  async decline(user: AuthUser, requestId: string): Promise<void> {
    const profile = await this.marketplace.requireVerifiedProfile(user);
    const request = await this.visibleToDriver(profile, requestId);
    await this.db.tx(async () => {
      await this.db.exec(
        `INSERT INTO request_declines (request_id, driver_profile_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [request.id, profile.id],
      );
      await this.db.exec(
        `UPDATE quotes SET status = 'withdrawn' WHERE request_id = $1 AND driver_profile_id = $2 AND status = 'active'`,
        [request.id, profile.id],
      );
    });
  }

  // =====================================================================================
  // Upkeep
  // =====================================================================================

  /** Closes requests and quotes whose time has passed. `customerId` limits it to one customer's rows. */
  async expireDue(customerId?: string): Promise<number> {
    return this.db.tx(async () => {
      const params: unknown[] = [];
      let cond = `status = 'open' AND expires_at <= now()`;
      if (customerId) {
        params.push(customerId);
        cond += ` AND customer_id = $1`;
      }
      const expired = await this.db.query<{ id: string; customer_id: string }>(
        `UPDATE ride_requests SET status = 'expired' WHERE ${cond} RETURNING id, customer_id`,
        params,
      );
      for (const r of expired) {
        const closed = await this.db.exec(`UPDATE quotes SET status = 'expired' WHERE request_id = $1 AND status = 'active'`, [r.id]);
        await this.outbox.publish(BookingEvents.RequestExpired, {
          requestId: r.id,
          customerId: r.customer_id,
          hadQuotes: closed > 0,
        } satisfies RequestExpiredEvent);
      }
      if (!customerId) {
        await this.db.exec(`UPDATE quotes SET status = 'expired' WHERE status = 'active' AND valid_until <= now()`);
      }
      return expired.length;
    });
  }

  async stats(): Promise<{ openNow: number; last7Days: number; quotedShare: number | null }> {
    const r = await this.db.one<{ open: number; week: number; quoted: number }>(
      `SELECT (SELECT count(*)::int FROM ride_requests WHERE status = 'open' AND expires_at > now()) AS open,
              (SELECT count(*)::int FROM ride_requests WHERE created_at >= now() - interval '7 days') AS week,
              (SELECT count(DISTINCT q.request_id)::int FROM quotes q JOIN ride_requests r ON r.id = q.request_id
                WHERE r.created_at >= now() - interval '7 days') AS quoted`,
    );
    const week = r?.week ?? 0;
    return { openNow: r?.open ?? 0, last7Days: week, quotedShare: week === 0 ? null : Math.round(((r?.quoted ?? 0) / week) * 100) / 100 };
  }

  /** Requests that match this partner, whatever their state - the basis of "enquiries received". */
  async countEnquiries(profile: DriverProfileRow, since: Date): Promise<number> {
    const criteria = await this.marketplace.matchCriteria(profile);
    const r = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM ride_requests r
        WHERE r.created_at >= $1 AND r.customer_id <> $2
          AND (r.target_driver_id = $3
               OR (r.target_driver_id IS NULL AND r.category_code = ANY($4::text[]) AND r.region_slug = ANY($5::text[])))`,
      [since, profile.user_id, profile.id, criteria.categoryCodes, criteria.serviceAreas],
    );
    return r?.n ?? 0;
  }

  // =====================================================================================
  // Internals
  // =====================================================================================

  /** The caller's own request. Someone else's id gives the same "not found" as an unknown one. */
  private async ownRequest(user: AuthUser, requestId: string, lock = false): Promise<RideRequestRow> {
    await this.db.exec(
      `UPDATE ride_requests SET status = 'expired' WHERE id = $1 AND customer_id = $2 AND status = 'open' AND expires_at <= now()`,
      [requestId, user.id],
    );
    const row = await this.db.one<RideRequestRow>(`SELECT * FROM ride_requests WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [requestId]);
    if (!row || row.customer_id !== user.id) throw AppError.notFound('Request');
    return row;
  }

  /**
   * Which open requests a partner may see: ones addressed to them, or ones for
   * a vehicle type they can operate, in an area they serve (or close to where
   * they are right now). Never their own, never ones they declined.
   */
  private feedQuery(profile: DriverProfileRow, criteria: DriverMatchCriteria, requestId?: string): { sql: string; params: unknown[] } {
    const params: unknown[] = [profile.id, profile.user_id, criteria.categoryCodes, criteria.serviceAreas];
    let near = 'false';
    let distance = 'NULL::float8';
    if (criteria.position) {
      params.push(criteria.position.lng, criteria.position.lat);
      const point = `ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography`;
      near = `ST_DWithin(r.pickup_location, ${point}, ${NEARBY_PICKUP_METERS})`;
      distance = `ST_Distance(r.pickup_location, ${point})`;
    }
    let idFilter = '';
    if (requestId) {
      params.push(requestId);
      idFilter = `AND r.id = $${params.length}`;
    }
    const sql = `
      SELECT r.*, u.display_name AS customer_name, ${distance} AS distance_m,
             (SELECT count(*)::int FROM quotes q
               WHERE q.request_id = r.id AND q.status = 'active' AND q.driver_profile_id <> $1) AS competing
        FROM ride_requests r JOIN users u ON u.id = r.customer_id
       WHERE r.status = 'open' AND r.expires_at > now() AND r.customer_id <> $2 ${idFilter}
         AND NOT EXISTS (SELECT 1 FROM request_declines d WHERE d.request_id = r.id AND d.driver_profile_id = $1)
         AND (r.target_driver_id = $1
              OR (r.target_driver_id IS NULL AND r.category_code = ANY($3::text[])
                  AND (r.region_slug = ANY($4::text[]) OR ${near})))`;
    return { sql, params };
  }

  private async visibleToDriver(profile: DriverProfileRow, requestId: string): Promise<FeedRow> {
    const criteria = await this.marketplace.matchCriteria(profile);
    const { sql, params } = this.feedQuery(profile, criteria, requestId);
    const row = await this.db.one<FeedRow>(sql, params);
    if (!row) throw AppError.notFound('Request');
    return row;
  }

  private async toFeedItems(rows: FeedRow[], driverProfileId: string): Promise<DriverRequestFeedItem[]> {
    if (rows.length === 0) return [];
    const mine = await this.db.query<QuoteRow>(
      `SELECT DISTINCT ON (request_id) * FROM quotes
        WHERE driver_profile_id = $1 AND request_id = ANY($2::uuid[])
        ORDER BY request_id, created_at DESC`,
      [driverProfileId, rows.map((r) => r.id)],
    );
    const byRequest = new Map(mine.map((q) => [q.request_id, q]));
    return rows.map((r) => {
      const q = byRequest.get(r.id);
      return {
        requestId: r.id,
        tripType: r.trip_type,
        pickup: r.pickup,
        drop: r.drop_place,
        scheduledAt: iso(r.scheduled_at),
        returnAt: iso(r.return_at),
        categoryCode: r.category_code,
        passengers: r.passengers,
        luggage: r.luggage,
        notes: r.notes,
        packageTitle: r.package_title,
        // First name only: a partner learns who the customer is once a booking exists.
        customerFirstName: firstName(r.customer_name),
        distanceToPickupKm: r.distance_m === null ? null : roundKm(Number(r.distance_m) / 1000),
        estimate: r.estimate,
        directRequest: r.target_driver_id === driverProfileId,
        myQuote: q ? { id: q.id, status: q.status, fare: inr(q.fare_minor), validUntil: isoReq(q.valid_until) } : null,
        competingQuotes: r.competing,
        createdAt: isoReq(r.created_at),
        expiresAt: isoReq(r.expires_at),
      };
    });
  }

  private async toRequest(row: RideRequestRow): Promise<RideRequest> {
    return (await this.toRequests([row]))[0]!;
  }

  private async toRequests(rows: RideRequestRow[]): Promise<RideRequest[]> {
    if (rows.length === 0) return [];
    const quotes = await this.db.query<QuoteRow>(
      `SELECT * FROM quotes WHERE request_id = ANY($1::uuid[]) AND status IN ('active','accepted','closed','expired')
        ORDER BY (status = 'accepted') DESC, (status = 'active') DESC, fare_minor ASC, created_at ASC`,
      [rows.map((r) => r.id)],
    );
    const dtos = await this.toQuotes(quotes);
    const categories = await this.catalog.categoryMap();
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      tripType: r.trip_type,
      pickup: r.pickup,
      drop: r.drop_place,
      scheduledAt: iso(r.scheduled_at),
      returnAt: iso(r.return_at),
      categoryCode: r.category_code,
      categoryName: categories.get(r.category_code)?.name ?? r.category_code,
      passengers: r.passengers,
      luggage: r.luggage,
      notes: r.notes,
      packageId: r.package_id,
      packageTitle: r.package_title,
      targetDriverId: r.target_driver_id,
      estimate: r.estimate,
      driversNotified: r.drivers_notified,
      quotes: dtos.filter((q) => q.requestId === r.id),
      bookingId: r.booking_id,
      createdAt: isoReq(r.created_at),
      expiresAt: isoReq(r.expires_at),
    }));
  }

  private async toQuotes(rows: QuoteRow[]): Promise<Quote[]> {
    if (rows.length === 0) return [];
    const drivers: Map<string, DriverCard> = await this.marketplace.driverCards(rows.map((q) => q.driver_profile_id));
    const vehicles: Map<string, VehicleCard> = await this.marketplace.vehicleCards(rows.map((q) => q.vehicle_id));
    return rows.map((q) => {
      const d = drivers.get(q.driver_profile_id);
      const v = vehicles.get(q.vehicle_id);
      // An active quote past its validity is reported as expired even before the sweeper runs.
      const status = q.status === QuoteStatus.Active && q.valid_until.getTime() <= Date.now() ? QuoteStatus.Expired : q.status;
      return {
        id: q.id,
        requestId: q.request_id,
        status,
        driver: {
          driverId: q.driver_profile_id,
          displayName: d?.displayName ?? 'Driver',
          photoUrl: d?.photoUrl ?? null,
          isVerified: d?.isVerified ?? false,
          rating: d?.rating ?? { average: null, count: 0 },
          completedTrips: d?.completedTrips ?? 0,
          languages: d?.languages ?? [],
        },
        vehicle: v!.summary,
        fare: inr(q.fare_minor),
        inclusions: q.inclusions,
        exclusions: q.exclusions,
        pickupNote: q.pickup_note,
        etaMinutes: q.eta_minutes,
        validUntil: isoReq(q.valid_until),
        createdAt: isoReq(q.created_at),
      };
    });
  }
}

function cleanLines(lines: string[] | undefined, field: string): string[] {
  const cleaned = [...new Set((lines ?? []).map((l) => l.trim()).filter(Boolean))];
  if (cleaned.length > MAX_QUOTE_LINE_ITEMS) throw AppError.invalid(field, `List at most ${MAX_QUOTE_LINE_ITEMS} items.`);
  return cleaned;
}
