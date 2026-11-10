import { Injectable } from '@nestjs/common';
import {
  AvailabilityStatus,
  ErrorCode,
  LOCATION_RECENT_MAX_AGE_SECONDS,
  REQUIRED_VEHICLE_DOCUMENT_TYPES,
  VerificationStatus,
  type LatLng,
  type RatingSummary,
  type VehicleSummary,
} from '@payana/contracts';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import { UploadsService } from '../../storage/application/uploads.service.js';
import { ratingOf, toVehicleSummary, type DriverProfileRow, type VehicleRow } from '../infrastructure/rows.js';
import { PartnerService } from './partner.service.js';

/** What other modules may know about a partner. */
export interface DriverCard {
  driverProfileId: string;
  userId: string;
  displayName: string;
  photoUrl: string | null;
  isVerified: boolean;
  rating: RatingSummary;
  completedTrips: number;
  languages: string[];
  /** For contact inside an active booking only - callers decide whether to expose it. */
  phone: string | null;
}

export interface VehicleCard {
  summary: VehicleSummary;
  registrationNumber: string;
  categoryCode: string;
  seats: number;
}

export interface DriverMatchCriteria {
  driverProfileId: string;
  /** Categories of the vehicles this partner may operate. */
  categoryCodes: string[];
  serviceAreas: string[];
  /** Last position, only when it is fresh enough to trust. */
  position: LatLng | null;
}

/**
 * The marketplace module's public API for other modules (bookings, billing,
 * engagement). They never query marketplace tables themselves.
 */
@Injectable()
export class MarketplaceFacade {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly uploads: UploadsService,
  ) {}

  async driverCards(profileIds: string[]): Promise<Map<string, DriverCard>> {
    const out = new Map<string, DriverCard>();
    if (profileIds.length === 0) return out;
    const rows = await this.db.query<DriverProfileRow & { phone: string | null }>(
      `SELECT dp.*, u.phone FROM driver_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = ANY($1::uuid[])`,
      [[...new Set(profileIds)]],
    );
    for (const r of rows) {
      out.set(r.id, {
        driverProfileId: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        photoUrl: await this.uploads.publicUrl(r.photo_key),
        isVerified: r.verification_status === VerificationStatus.Approved,
        rating: ratingOf(r),
        completedTrips: r.completed_trips,
        languages: r.languages,
        phone: r.phone,
      });
    }
    return out;
  }

  async vehicleCards(vehicleIds: string[]): Promise<Map<string, VehicleCard>> {
    const out = new Map<string, VehicleCard>();
    if (vehicleIds.length === 0) return out;
    const rows = await this.db.query<VehicleRow>(`SELECT * FROM vehicles WHERE id = ANY($1::uuid[])`, [[...new Set(vehicleIds)]]);
    const categories = await this.catalog.categoryMap();
    for (const v of rows) {
      out.set(v.id, {
        summary: toVehicleSummary(v, categories.get(v.category_code), await this.uploads.publicUrl(v.photo_keys[0])),
        registrationNumber: v.registration_number,
        categoryCode: v.category_code,
        seats: v.seats,
      });
    }
    return out;
  }

  /** The caller's partner profile, which must be verified - otherwise `driver_not_verified`. */
  async requireVerifiedProfile(user: AuthUser): Promise<DriverProfileRow> {
    const profile = await this.profileOf(user);
    if (!profile) throw AppError.conflict('Create your partner profile first.');
    if (profile.verification_status !== VerificationStatus.Approved) {
      throw AppError.forbidden('Your profile must be verified before you can use this.', ErrorCode.DriverNotVerified);
    }
    return profile;
  }

  async profileOf(user: AuthUser): Promise<DriverProfileRow | null> {
    return this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE user_id = $1`, [user.id]);
  }

  async matchCriteria(profile: DriverProfileRow): Promise<DriverMatchCriteria> {
    const rows = await this.db.query<{ category_code: string }>(
      `SELECT DISTINCT v.category_code FROM vehicles v
        WHERE v.deleted_at IS NULL AND v.listing_status = 'published' AND v.verification_status = 'approved'
          AND (v.owner_profile_id = $1 OR EXISTS (
                SELECT 1 FROM vehicle_authorizations a
                 WHERE a.vehicle_id = v.id AND a.driver_profile_id = $1 AND a.status = 'active'
                   AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE)))`,
      [profile.id],
    );
    const fresh =
      profile.location_updated_at !== null &&
      Date.now() - profile.location_updated_at.getTime() <= LOCATION_RECENT_MAX_AGE_SECONDS * 1000 &&
      profile.last_lat !== null &&
      profile.last_lng !== null;
    return {
      driverProfileId: profile.id,
      categoryCodes: rows.map((r) => r.category_code),
      serviceAreas: profile.service_areas,
      position: fresh ? { lat: profile.last_lat!, lng: profile.last_lng! } : null,
    };
  }

  /**
   * Partners a new ride request should be offered to: verified, listed, with
   * an operable vehicle of the requested category that has valid documents,
   * serving the pickup region. For an immediate trip only those online.
   */
  async eligibleDrivers(input: {
    categoryCode: string;
    regionSlug: string | null;
    targetDriverId: string | null;
    onlineOnly: boolean;
    minSeats: number;
  }): Promise<{ driverProfileId: string; userId: string }[]> {
    const params: unknown[] = [input.categoryCode, [...REQUIRED_VEHICLE_DOCUMENT_TYPES], input.minSeats];
    const where = [`dp.listing_status = 'published'`, `dp.verification_status = 'approved'`, `u.status = 'active'`];
    if (input.targetDriverId) {
      params.push(input.targetDriverId);
      where.push(`dp.id = $${params.length}`);
    } else {
      if (input.regionSlug) {
        params.push(input.regionSlug);
        where.push(`$${params.length} = ANY(dp.service_areas)`);
      }
      if (input.onlineOnly) where.push(`dp.availability = '${AvailabilityStatus.Available}'`);
    }
    return this.db.query<{ driverProfileId: string; userId: string }>(
      `SELECT dp.id AS "driverProfileId", dp.user_id AS "userId"
         FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
        WHERE ${where.join(' AND ')}
          AND EXISTS (
            SELECT 1 FROM vehicles v
             WHERE v.category_code = $1 AND v.seats >= $3 AND v.deleted_at IS NULL
               AND v.listing_status = 'published' AND v.verification_status = 'approved'
               AND vehicle_documents_ok(v.id, $2)
               AND (v.owner_profile_id = dp.id OR EXISTS (
                     SELECT 1 FROM vehicle_authorizations a
                      WHERE a.vehicle_id = v.id AND a.driver_profile_id = dp.id AND a.status = 'active'
                        AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE))))
        LIMIT 200`,
      params,
    );
  }

  /** True when the partner is a listed, verified driver a customer may address directly. */
  async isBookable(driverProfileId: string): Promise<boolean> {
    const row = await this.db.one(
      `SELECT 1 FROM driver_profiles dp JOIN users u ON u.id = dp.user_id AND u.status = 'active'
        WHERE dp.id = $1 AND dp.listing_status = 'published' AND dp.verification_status = 'approved'`,
      [driverProfileId],
    );
    return row !== null;
  }

  // --- counters maintained on behalf of bookings and reviews ---------------------------

  async recordBookingWon(driverProfileId: string): Promise<void> {
    await this.db.exec(`UPDATE driver_profiles SET accepted_bookings = accepted_bookings + 1 WHERE id = $1`, [driverProfileId]);
  }

  async recordTripStarted(driverProfileId: string): Promise<void> {
    await this.db.exec(
      `UPDATE driver_profiles SET availability = 'busy', updated_at = now() WHERE id = $1 AND availability = 'available'`,
      [driverProfileId],
    );
  }

  async recordTripCompleted(driverProfileId: string): Promise<void> {
    await this.db.exec(
      `UPDATE driver_profiles
          SET completed_trips = completed_trips + 1,
              availability = CASE WHEN availability = 'busy' THEN 'available' ELSE availability END,
              updated_at = now()
        WHERE id = $1`,
      [driverProfileId],
    );
  }

  async recordDriverCancellation(driverProfileId: string): Promise<void> {
    await this.db.exec(`UPDATE driver_profiles SET cancelled_bookings = cancelled_bookings + 1 WHERE id = $1`, [driverProfileId]);
  }

  /** Releases a driver marked busy when their trip ends without completing. */
  async releaseIfBusy(driverProfileId: string): Promise<void> {
    await this.db.exec(
      `UPDATE driver_profiles SET availability = 'available', updated_at = now() WHERE id = $1 AND availability = 'busy'`,
      [driverProfileId],
    );
  }

  async setRating(driverProfileId: string, average: number | null, count: number): Promise<void> {
    await this.db.exec(`UPDATE driver_profiles SET rating_average = $2, rating_count = $3 WHERE id = $1`, [
      driverProfileId,
      average,
      count,
    ]);
  }

  async profileStats(driverProfileId: string): Promise<{ rating: RatingSummary; profileViews: number; cancellationBase: { accepted: number; cancelled: number } } | null> {
    const r = await this.db.one<DriverProfileRow>(`SELECT * FROM driver_profiles WHERE id = $1`, [driverProfileId]);
    if (!r) return null;
    return {
      rating: ratingOf(r),
      profileViews: r.profile_views,
      cancellationBase: { accepted: r.accepted_bookings, cancelled: r.cancelled_bookings },
    };
  }

  async vehicleOwnedBy(vehicleId: string, driverProfileId: string): Promise<VehicleRow | null> {
    const v = await this.db.one<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL`, [vehicleId]);
    return v && v.owner_profile_id === driverProfileId ? v : null;
  }

  async countVehicles(driverProfileId: string): Promise<number> {
    const r = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vehicles WHERE owner_profile_id = $1 AND deleted_at IS NULL`,
      [driverProfileId],
    );
    return r?.n ?? 0;
  }

  /** Headline numbers for the admin overview. */
  async overviewCounts(): Promise<{ total: number; verified: number; pendingVerification: number; availableNow: number; documentsExpiring: number }> {
    const r = await this.db.one<{ total: number; verified: number; pending: number; available: number; expiring: number }>(
      `SELECT (SELECT count(*)::int FROM driver_profiles) AS total,
              (SELECT count(*)::int FROM driver_profiles WHERE verification_status = 'approved') AS verified,
              (SELECT count(*)::int FROM driver_profiles WHERE verification_status = 'pending') AS pending,
              (SELECT count(*)::int FROM driver_profiles WHERE availability = 'available' AND verification_status = 'approved') AS available,
              (SELECT count(*)::int FROM driver_documents
                WHERE is_current AND status = 'approved' AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS expiring`,
    );
    return {
      total: r?.total ?? 0,
      verified: r?.verified ?? 0,
      pendingVerification: r?.pending ?? 0,
      availableNow: r?.available ?? 0,
      documentsExpiring: r?.expiring ?? 0,
    };
  }
}

/**
 * Operations that need the partner rules themselves. Kept apart from
 * MarketplaceFacade so that the facade has no dependency on PartnerService
 * (which depends on the billing module's entitlements).
 */
@Injectable()
export class PartnerOperations {
  constructor(private readonly partners: PartnerService) {}

  /** Allowed to operate this vehicle right now: owner or authorised, with valid documents. */
  assertCanOperate(profile: DriverProfileRow, vehicleId: string): Promise<VehicleRow> {
    return this.partners.assertCanOperate(profile, vehicleId);
  }
}
