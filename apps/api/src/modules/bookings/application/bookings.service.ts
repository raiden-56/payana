import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  AccountRole,
  BookingStatus,
  ErrorCode,
  FeatureFlag,
  type AdminBookingQuery,
  type AdminBookingRow,
  type Booking,
  type BookingListQuery,
  type CancelBookingRequest,
  type DriverMetrics,
  type Paginated,
  type Receipt,
  type ResolveDisputeRequest,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db, json } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { inr, iso, isoReq } from '../../../common/money.js';
import { OutboxService } from '../../../common/outbox/outbox.service.js';
import { ENTITLEMENTS, type EntitlementsPort } from '../../../common/ports.js';
import { MarketplaceFacade } from '../../marketplace/application/marketplace.facade.js';
import { SettingsService } from '../../platform/application/settings.service.js';
import {
  allowedActions,
  canDispute,
  cancellationFeeMinor,
  checkDriverTransition,
  isActive,
  isCancellable,
  type Party,
} from '../domain/booking-rules.js';
import type { BookingEventRow, BookingRow } from '../infrastructure/rows.js';
import { BookingEvents, type BookingCancelledEvent, type BookingStatusChangedEvent } from './events.js';

interface PartyRow {
  customer_name: string | null;
  customer_phone: string | null;
}

/** Bookings: what each party may see and do once a quote has been accepted. */
@Injectable()
export class BookingsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly marketplace: MarketplaceFacade,
    private readonly settings: SettingsService,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementsPort,
  ) {}

  // --- reading ---------------------------------------------------------------------------

  async listForCustomer(user: AuthUser, q: BookingListQuery): Promise<Paginated<Booking>> {
    return this.listWhere(`b.customer_id = $1`, [user.id], q, 'customer');
  }

  async listForDriver(user: AuthUser, q: BookingListQuery): Promise<Paginated<Booking>> {
    if (!user.driverProfileId) return paginated([], 0, pageWindow(q));
    return this.listWhere(`b.driver_profile_id = $1`, [user.driverProfileId], q, 'driver');
  }

  /** A booking as seen by one of its two parties. Anyone else gets "not found". */
  async getForParty(user: AuthUser, bookingId: string): Promise<Booking> {
    const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    const viewer = row ? this.partyOf(user, row) : null;
    if (!row || !viewer) throw AppError.notFound('Booking');
    return (await this.toDtos([row], viewer))[0]!;
  }

  async getForAdmin(bookingId: string): Promise<Booking> {
    const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (!row) throw AppError.notFound('Booking');
    return (await this.toDtos([row], 'admin'))[0]!;
  }

  async receipt(user: AuthUser, bookingId: string): Promise<Receipt> {
    const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (!row || !this.partyOf(user, row)) throw AppError.notFound('Booking');
    if (row.status !== BookingStatus.Completed) throw AppError.conflict('A receipt is available once the trip is completed.');
    const drivers = await this.marketplace.driverCards([row.driver_profile_id]);
    const vehicles = await this.marketplace.vehicleCards([row.vehicle_id]);
    const customer = await this.db.one<PartyRow>(
      `SELECT display_name AS customer_name, phone AS customer_phone FROM users WHERE id = $1`,
      [row.customer_id],
    );
    const v = vehicles.get(row.vehicle_id);
    return {
      bookingCode: row.code,
      issuedAt: isoReq(row.completed_at ?? row.created_at),
      customerName: customer?.customer_name ?? 'Customer',
      driverName: drivers.get(row.driver_profile_id)?.displayName ?? 'Driver',
      vehicleLabel: v ? `${v.summary.make} ${v.summary.model}` : 'Vehicle',
      registrationNumber: v?.registrationNumber ?? '',
      tripType: row.trip_type,
      pickupLabel: row.pickup.label,
      dropLabel: row.drop_place?.label ?? row.package_title,
      startedAt: iso(row.started_at),
      completedAt: iso(row.completed_at),
      fare: { quoted: inr(row.quoted_minor), bookingFee: inr(row.booking_fee_minor), total: inr(row.total_minor) },
      paymentNote:
        row.booking_fee_minor > 0
          ? 'Fare paid directly to the driver. The booking fee is charged by Payana.'
          : 'Paid directly to the driver. Payana charged no booking fee.',
    };
  }

  // --- changing --------------------------------------------------------------------------

  /** A status change requested by the booking's driver. */
  async transition(user: AuthUser, bookingId: string, to: BookingStatus): Promise<Booking> {
    await this.db.tx(async () => {
      const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
      // Only the driver of this booking may move it; everyone else learns nothing about it.
      if (!row || !user.driverProfileId || row.driver_profile_id !== user.driverProfileId) throw AppError.notFound('Booking');
      const arrived = await this.db.one<{ at: Date }>(
        `SELECT at FROM booking_events WHERE booking_id = $1 AND status = 'driver_arrived' ORDER BY at DESC LIMIT 1`,
        [row.id],
      );
      const check = checkDriverTransition({
        from: row.status,
        to,
        scheduledAt: row.scheduled_at,
        arrivedAt: arrived?.at ?? null,
        now: new Date(),
      });
      if (!check.ok) throw AppError.conflict(check.reason, ErrorCode.InvalidTransition);

      await this.db.update('bookings', { id: row.id }, {
        status: to,
        started_at: to === BookingStatus.InProgress ? new Date() : undefined,
        completed_at: to === BookingStatus.Completed ? new Date() : undefined,
        updated_at: new Date(),
      });
      await this.db.insert('booking_events', { booking_id: row.id, status: to, actor: 'driver' });
      if (to === BookingStatus.InProgress) await this.marketplace.recordTripStarted(row.driver_profile_id);
      if (to === BookingStatus.Completed) await this.marketplace.recordTripCompleted(row.driver_profile_id);
      if (to === BookingStatus.NoShow) await this.marketplace.releaseIfBusy(row.driver_profile_id);
      await this.outbox.publish(BookingEvents.StatusChanged, {
        bookingId: row.id,
        bookingCode: row.code,
        status: to,
        customerId: row.customer_id,
        driverUserId: user.id,
        actor: 'driver',
      } satisfies BookingStatusChangedEvent);
    });
    return this.getForParty(user, bookingId);
  }

  async cancel(user: AuthUser, bookingId: string, input: CancelBookingRequest): Promise<Booking> {
    await this.db.tx(async () => {
      const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
      const by = row ? this.partyOf(user, row) : null;
      if (!row || !by) throw AppError.notFound('Booking');
      if (!isCancellable(row.status)) {
        throw AppError.conflict(
          row.status === BookingStatus.InProgress
            ? 'A trip that has started cannot be cancelled. Ask the driver to end it, or contact support.'
            : 'This booking can no longer be cancelled.',
          ErrorCode.CancellationNotAllowed,
        );
      }
      const status = by === 'customer' ? BookingStatus.CancelledByCustomer : BookingStatus.CancelledByDriver;
      const fee = cancellationFeeMinor(row.cancellation_policy, row.scheduled_at, new Date(), by);
      await this.db.update('bookings', { id: row.id }, {
        status,
        cancellation: json({ reason: input.reason, note: input.note?.trim() || null, feeChargedMinor: fee }),
        updated_at: new Date(),
      });
      await this.db.insert('booking_events', { booking_id: row.id, status, actor: by, note: input.reason });
      if (by === 'driver') await this.marketplace.recordDriverCancellation(row.driver_profile_id);
      await this.marketplace.releaseIfBusy(row.driver_profile_id);
      const driver = (await this.marketplace.driverCards([row.driver_profile_id])).get(row.driver_profile_id);
      await this.outbox.publish(BookingEvents.Cancelled, {
        bookingId: row.id,
        bookingCode: row.code,
        status,
        customerId: row.customer_id,
        driverUserId: driver?.userId ?? '',
        actor: by,
        reason: input.reason,
      } satisfies BookingCancelledEvent);
      await this.audit.record({
        actor: user,
        action: 'booking.cancelled',
        targetType: 'booking',
        targetId: row.id,
        metadata: { code: row.code, by, reason: input.reason, feeChargedMinor: fee },
      });
    });
    return this.getForParty(user, bookingId);
  }

  /** Called by the support module when a party opens a fare dispute on a booking. */
  async markDisputed(user: AuthUser, bookingId: string): Promise<{ code: string; disputed: boolean }> {
    return this.db.tx(async () => {
      const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
      const by = row ? this.partyOf(user, row) : null;
      if (!row || !by) throw AppError.invalid('bookingId', 'This booking does not exist.');
      if (!canDispute(row.status, row.completed_at, new Date())) return { code: row.code, disputed: false };
      await this.db.update('bookings', { id: row.id }, { status: BookingStatus.Disputed, updated_at: new Date() });
      await this.db.insert('booking_events', { booking_id: row.id, status: BookingStatus.Disputed, actor: by, note: 'Dispute opened' });
      await this.audit.record({ actor: user, action: 'booking.disputed', targetType: 'booking', targetId: row.id, metadata: { code: row.code, by } });
      return { code: row.code, disputed: true };
    });
  }

  /** Confirms that the caller is a party to the booking and returns its reference. */
  async referenceForParty(user: AuthUser, bookingId: string): Promise<string> {
    const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (!row || !this.partyOf(user, row)) throw AppError.invalid('bookingId', 'This booking does not exist.');
    return row.code;
  }

  /** Facts the review rules need, for the customer of the booking only. */
  async reviewContext(
    user: AuthUser,
    bookingId: string,
  ): Promise<{ row: BookingRow; customerName: string | null } | null> {
    const row = await this.db.one<BookingRow & { customer_name: string | null }>(
      `SELECT b.*, u.display_name AS customer_name FROM bookings b JOIN users u ON u.id = b.customer_id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId],
    );
    if (!row || row.customer_id !== user.id) return null;
    return { row, customerName: row.customer_name };
  }

  async markReviewed(bookingId: string): Promise<void> {
    await this.db.exec(`UPDATE bookings SET review_submitted = true, updated_at = now() WHERE id = $1`, [bookingId]);
  }

  // --- administration ---------------------------------------------------------------------

  async adminList(q: AdminBookingQuery): Promise<Paginated<AdminBookingRow>> {
    const w = pageWindow(q);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.status) add(`b.status = ?`, q.status);
    if (q.q) add(`(b.code ILIKE ? OR u.display_name ILIKE ? OR dp.display_name ILIKE ?)`, `%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
    if (q.from) add(`b.scheduled_at >= ?::date`, q.from);
    if (q.to) add(`b.scheduled_at < (?::date + 1)`, q.to);
    const from = `FROM bookings b JOIN users u ON u.id = b.customer_id JOIN driver_profiles dp ON dp.id = b.driver_profile_id
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params);
    const rows = await this.db.query<BookingRow & { customer_name: string | null; driver_name: string }>(
      `SELECT b.*, u.display_name AS customer_name, dp.display_name AS driver_name ${from}
        ORDER BY b.created_at DESC LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(
      rows.map((b) => ({
        id: b.id,
        code: b.code,
        status: b.status,
        tripType: b.trip_type,
        customerName: b.customer_name ?? 'Customer',
        driverName: b.driver_name,
        pickupLabel: b.pickup.label,
        dropLabel: b.drop_place?.label ?? b.package_title,
        scheduledAt: isoReq(b.scheduled_at),
        quoted: inr(b.quoted_minor),
        createdAt: isoReq(b.created_at),
      })),
      total?.n ?? 0,
      w,
    );
  }

  async resolveDispute(bookingId: string, input: ResolveDisputeRequest, actor: AuthUser): Promise<Booking> {
    await this.db.tx(async () => {
      const row = await this.db.one<BookingRow>(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
      if (!row) throw AppError.notFound('Booking');
      if (row.status !== BookingStatus.Disputed) throw AppError.conflict('Only a disputed booking can be resolved.', ErrorCode.InvalidTransition);
      const status = input.outcome === 'completed' ? BookingStatus.Completed : BookingStatus.CancelledByAdmin;
      await this.db.update('bookings', { id: row.id }, {
        status,
        completed_at: status === BookingStatus.Completed ? (row.completed_at ?? new Date()) : undefined,
        updated_at: new Date(),
      });
      await this.db.insert('booking_events', { booking_id: row.id, status, actor: 'admin', note: input.note.trim() });
      const driver = (await this.marketplace.driverCards([row.driver_profile_id])).get(row.driver_profile_id);
      await this.outbox.publish(BookingEvents.StatusChanged, {
        bookingId: row.id,
        bookingCode: row.code,
        status,
        customerId: row.customer_id,
        driverUserId: driver?.userId ?? '',
        actor: 'admin',
      } satisfies BookingStatusChangedEvent);
      await this.audit.record({
        actor,
        action: 'booking.dispute_resolved',
        targetType: 'booking',
        targetId: row.id,
        metadata: { code: row.code, outcome: input.outcome },
      });
    });
    return this.getForAdmin(bookingId);
  }

  async stats(): Promise<{
    activeNow: number;
    completedLast7Days: number;
    cancelledLast7Days: number;
    disputed: number;
    trend: { date: string; requests: number; bookings: number }[];
  }> {
    const r = await this.db.one<{ active: number; completed: number; cancelled: number; disputed: number }>(
      `SELECT (SELECT count(*)::int FROM bookings WHERE status = ANY($1)) AS active,
              (SELECT count(*)::int FROM bookings WHERE status = 'completed' AND completed_at >= now() - interval '7 days') AS completed,
              (SELECT count(*)::int FROM bookings WHERE status LIKE 'cancelled_%' AND updated_at >= now() - interval '7 days') AS cancelled,
              (SELECT count(*)::int FROM bookings WHERE status = 'disputed') AS disputed`,
      [[...ACTIVE_BOOKING_STATUSES]],
    );
    const trend = await this.db.query<{ date: string; requests: number; bookings: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              (SELECT count(*)::int FROM ride_requests r WHERE r.created_at::date = d) AS requests,
              (SELECT count(*)::int FROM bookings b WHERE b.created_at::date = d) AS bookings
         FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') AS g(d)
        ORDER BY d`,
    );
    return {
      activeNow: r?.active ?? 0,
      completedLast7Days: r?.completed ?? 0,
      cancelledLast7Days: r?.cancelled ?? 0,
      disputed: r?.disputed ?? 0,
      trend,
    };
  }

  // --- partner metrics -----------------------------------------------------------------------

  async metrics(user: AuthUser, periodDays: number, enquiries: (since: Date) => Promise<number>): Promise<DriverMetrics> {
    const profile = await this.marketplace.profileOf(user);
    if (!profile) throw AppError.conflict('Create your partner profile first.');
    const plan = await this.entitlements.forDriver(profile.id);
    if (!plan.analytics) {
      throw new AppError(403, ErrorCode.EntitlementExceeded, 'Plan limit reached', 'The performance dashboard is part of the paid plans.');
    }
    const since = new Date(Date.now() - periodDays * 86_400_000);
    const r = await this.db.one<{ quotes: number; won: number; completed: number; fare: string | null }>(
      `SELECT (SELECT count(*)::int FROM quotes WHERE driver_profile_id = $1 AND created_at >= $2) AS quotes,
              (SELECT count(*)::int FROM bookings WHERE driver_profile_id = $1 AND created_at >= $2) AS won,
              (SELECT count(*)::int FROM bookings WHERE driver_profile_id = $1 AND status = 'completed' AND completed_at >= $2) AS completed,
              (SELECT COALESCE(sum(quoted_minor), 0) FROM bookings
                WHERE driver_profile_id = $1 AND status = 'completed' AND completed_at >= $2) AS fare`,
      [profile.id, since],
    );
    const stats = await this.marketplace.profileStats(profile.id);
    const base = stats?.cancellationBase ?? { accepted: 0, cancelled: 0 };
    return {
      periodDays,
      enquiriesReceived: await enquiries(since),
      quotesSent: r?.quotes ?? 0,
      bookingsWon: r?.won ?? 0,
      bookingsCompleted: r?.completed ?? 0,
      cancellationRate: base.accepted < 5 ? null : Math.round((base.cancelled / base.accepted) * 100) / 100,
      rating: stats?.rating ?? { average: null, count: 0 },
      completedFareTotal: inr(Number(r?.fare ?? 0)),
      profileViews: stats?.profileViews ?? 0,
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  private partyOf(user: AuthUser, row: BookingRow): Party | null {
    if (row.customer_id === user.id) return 'customer';
    if (user.driverProfileId && row.driver_profile_id === user.driverProfileId && user.roles.includes(AccountRole.Driver)) return 'driver';
    return null;
  }

  private async listWhere(cond: string, params: unknown[], q: BookingListQuery, viewer: Party): Promise<Paginated<Booking>> {
    const w = pageWindow(q);
    let scope = '';
    if (q.scope === 'active') {
      params.push([...ACTIVE_BOOKING_STATUSES]);
      scope = ` AND b.status = ANY($${params.length})`;
    } else if (q.scope === 'past') {
      params.push([...ACTIVE_BOOKING_STATUSES]);
      scope = ` AND NOT (b.status = ANY($${params.length}))`;
    }
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM bookings b WHERE ${cond}${scope}`, params);
    const rows = await this.db.query<BookingRow>(
      `SELECT b.* FROM bookings b WHERE ${cond}${scope}
        ORDER BY ${q.scope === 'active' ? 'b.scheduled_at ASC' : 'b.scheduled_at DESC'}, b.id
        LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );
    return paginated(await this.toDtos(rows, viewer), total?.n ?? 0, w);
  }

  private async toDtos(rows: BookingRow[], viewer: Party): Promise<Booking[]> {
    if (rows.length === 0) return [];
    const drivers = await this.marketplace.driverCards(rows.map((b) => b.driver_profile_id));
    const vehicles = await this.marketplace.vehicleCards(rows.map((b) => b.vehicle_id));
    const customers = new Map(
      (
        await this.db.query<{ id: string; display_name: string | null; phone: string | null }>(
          `SELECT id, display_name, phone FROM users WHERE id = ANY($1::uuid[])`,
          [[...new Set(rows.map((b) => b.customer_id))]],
        )
      ).map((u) => [u.id, u]),
    );
    const events = await this.db.query<BookingEventRow & { booking_id: string }>(
      `SELECT booking_id, status, at, actor, note FROM booking_events WHERE booking_id = ANY($1::uuid[]) ORDER BY at, id`,
      [rows.map((b) => b.id)],
    );
    const reviewsEnabled = await this.settings.isEnabled(FeatureFlag.Reviews);
    const now = new Date();

    return rows.map((b) => {
      const d = drivers.get(b.driver_profile_id);
      const v = vehicles.get(b.vehicle_id);
      const c = customers.get(b.customer_id);
      const active = isActive(b.status);
      // Phone numbers are shared only while the booking is live, and only with the other party
      // (support staff reading a booking see both).
      const customerPhone = viewer === 'admin' || (viewer === 'driver' && active) ? (c?.phone ?? null) : null;
      const driverPhone = viewer === 'admin' || (viewer === 'customer' && active) ? (d?.phone ?? null) : null;
      return {
        id: b.id,
        code: b.code,
        status: b.status,
        tripType: b.trip_type,
        pickup: b.pickup,
        drop: b.drop_place,
        scheduledAt: isoReq(b.scheduled_at),
        returnAt: iso(b.return_at),
        passengers: b.passengers,
        luggage: b.luggage,
        notes: b.notes,
        packageTitle: b.package_title,
        fare: { quoted: inr(b.quoted_minor), bookingFee: inr(b.booking_fee_minor), total: inr(b.total_minor) },
        inclusions: b.inclusions,
        exclusions: b.exclusions,
        pickupNote: b.pickup_note,
        customer: { id: b.customer_id, displayName: c?.display_name ?? 'Customer', photoUrl: null, phone: customerPhone },
        driver: {
          id: b.driver_profile_id,
          displayName: d?.displayName ?? 'Driver',
          photoUrl: d?.photoUrl ?? null,
          phone: driverPhone,
          rating: d?.rating,
        },
        vehicle: { ...v!.summary, registrationNumber: v!.registrationNumber },
        cancellationPolicy: b.cancellation_policy,
        cancellation: b.cancellation
          ? { reason: b.cancellation.reason, note: b.cancellation.note, feeCharged: inr(b.cancellation.feeChargedMinor) }
          : null,
        timeline: events
          .filter((e) => e.booking_id === b.id)
          .map((e) => ({ status: e.status, at: isoReq(e.at), actor: e.actor, note: e.note })),
        allowedActions: allowedActions(
          { status: b.status, reviewSubmitted: b.review_submitted, completedAt: b.completed_at, reviewsEnabled, now },
          viewer,
        ),
        reviewSubmitted: b.review_submitted,
        createdAt: isoReq(b.created_at),
        completedAt: iso(b.completed_at),
      };
    });
  }
}
