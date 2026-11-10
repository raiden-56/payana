import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SEARCH_RADIUS_KM,
  DriverSort,
  LOCATION_LIVE_MAX_AGE_SECONDS,
  LOCATION_RECENT_MAX_AGE_SECONDS,
  LocationFreshness,
  MAX_SEARCH_RADIUS_KM,
  REQUIRED_VEHICLE_DOCUMENT_TYPES,
  type AvailabilityStatus,
  type DriverListing,
  type DriverPublicProfile,
  type DriverSearchQuery,
  type LatLng,
  type OperatingHours,
  type Paginated,
  type PartnerType,
  type RelativeLocation,
} from '@payana/contracts';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { classifyFreshness, isFresh, roundBearing, roundKm } from '../../../common/geo.js';
import { pageWindow, paginated } from '../../../common/http/pagination.js';
import { iso, isoReq, numOrNull } from '../../../common/money.js';
import { CatalogService, type CategoryRow } from '../../catalog/application/catalog.service.js';
import { UploadsService } from '../../storage/application/uploads.service.js';
import { cancellationRate, ratesOf, toVehicleSummary, type VehicleRow } from '../infrastructure/rows.js';

interface ListingRow {
  driver_id: string;
  display_name: string;
  photo_key: string | null;
  languages: string[];
  years_experience: number | null;
  completed_trips: number;
  accepted_bookings: number;
  cancelled_bookings: number;
  rating_average: string | null;
  rating_count: number;
  service_areas: string[];
  availability: AvailabilityStatus;
  location_updated_at: Date | null;
  bio: string | null;
  partner_type: PartnerType;
  operating_hours: OperatingHours | null;
  created_at: Date;
  vehicle: VehicleRow;
  docs_ok: boolean;
  is_featured: boolean;
  plan_badge: string | null;
  distance_m: number | null;
  bearing_deg: number | null;
  total?: number;
}

/**
 * The vehicle a partner may operate: one they own, or one they hold an active
 * authorisation for. Only approved, published, non-deleted vehicles qualify.
 */
const OPERABLE_VEHICLE = `
  v.deleted_at IS NULL AND v.listing_status = 'published' AND v.verification_status = 'approved'
  AND (v.owner_profile_id = dp.id OR EXISTS (
        SELECT 1 FROM vehicle_authorizations a
         WHERE a.vehicle_id = v.id AND a.driver_profile_id = dp.id AND a.status = 'active'
           AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE)))`;

/**
 * Public discovery. This is a read model: besides marketplace tables it reads
 * account status, plan badge and featured placements so that one indexed
 * query can rank a page of listings.
 *
 * Privacy: a driver's coordinates never leave this service. Callers get a
 * distance and a bearing rounded to ten degrees - and only while the position
 * is fresh. A stale position is reported as stale, with no distance.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly uploads: UploadsService,
  ) {}

  async search(q: DriverSearchQuery): Promise<Paginated<DriverListing>> {
    const w = pageWindow(q);
    const point: LatLng | null = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    if ((q.lat === undefined) !== (q.lng === undefined)) {
      throw AppError.invalid(q.lat === undefined ? 'lat' : 'lng', 'Send both lat and lng, or neither.');
    }
    const radiusM = Math.min(q.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM) * 1000;
    const pointRegion = point ? await this.catalog.regionSlugAt(point) : null;
    const featuredRegion = q.regionSlug ?? pointRegion;

    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const required = p([...REQUIRED_VEHICLE_DOCUMENT_TYPES]);
    const freshSql = `(dp.location_updated_at IS NOT NULL AND dp.location_updated_at >= now() - make_interval(secs => ${LOCATION_RECENT_MAX_AGE_SECONDS}))`;
    const pointSql = point ? `ST_SetSRID(ST_MakePoint(${p(point.lng)}, ${p(point.lat)}), 4326)::geography` : null;

    const vehicleFilters: string[] = [OPERABLE_VEHICLE];
    if (q.categoryCode) vehicleFilters.push(`v.category_code = ${p(q.categoryCode)}`);
    if (q.minSeats) vehicleFilters.push(`v.seats >= ${p(q.minSeats)}`);

    const where: string[] = [`dp.listing_status = 'published'`, `dp.verification_status = 'approved'`];
    if (q.regionSlug) where.push(`${p(q.regionSlug)} = ANY(dp.service_areas)`);
    if (q.availableNow) where.push(`dp.availability = 'available'`);
    if (pointSql) {
      // Fresh position inside the radius; or - when the position cannot be trusted - a
      // driver who serves the area the search point is in (listed without a distance).
      const serves = pointRegion ? `${p(pointRegion)} = ANY(dp.service_areas)` : 'false';
      where.push(`((${freshSql} AND ST_DWithin(dp.last_location, ${pointSql}, ${p(radiusM)})) OR (NOT ${freshSql} AND ${serves}))`);
    }

    const featuredSql = `EXISTS (
        SELECT 1 FROM featured_placements fp
         WHERE fp.vehicle_id = v.id AND fp.status IN ('scheduled','active')
           AND CURRENT_DATE BETWEEN fp.starts_on AND fp.ends_on
           ${featuredRegion ? `AND fp.region_slug = ${p(featuredRegion)}` : ''})`;

    const order: Record<DriverSort, string> = {
      [DriverSort.Recommended]: `is_featured DESC, plan_priority DESC, (distance_m IS NULL), distance_m ASC, rating_average DESC NULLS LAST, completed_trips DESC`,
      [DriverSort.Nearest]: `(distance_m IS NULL), distance_m ASC, rating_average DESC NULLS LAST`,
      [DriverSort.Rating]: `rating_average DESC NULLS LAST, rating_count DESC`,
      [DriverSort.Price]: `effective_per_km ASC, rating_average DESC NULLS LAST`,
    };

    const rows = await this.db.query<ListingRow>(
      `SELECT *, count(*) OVER()::int AS total FROM (
         SELECT dp.id AS driver_id, dp.display_name, dp.photo_key, dp.languages, dp.years_experience,
                dp.completed_trips, dp.accepted_bookings, dp.cancelled_bookings, dp.rating_average, dp.rating_count,
                dp.service_areas, dp.availability, dp.location_updated_at, dp.bio, dp.partner_type,
                dp.operating_hours, dp.created_at,
                to_jsonb(v) AS vehicle,
                vehicle_documents_ok(v.id, ${required}) AS docs_ok,
                ${featuredSql} AS is_featured,
                plan.badge AS plan_badge,
                COALESCE(plan.priority, false) AS plan_priority,
                COALESCE(v.per_km_minor, c.per_km_minor) AS effective_per_km,
                ${pointSql ? `CASE WHEN ${freshSql} THEN ST_Distance(dp.last_location, ${pointSql}) END` : 'NULL::float8'} AS distance_m,
                ${pointSql ? `CASE WHEN ${freshSql} THEN degrees(ST_Azimuth(${pointSql}, dp.last_location)) END` : 'NULL::float8'} AS bearing_deg
           FROM driver_profiles dp
           JOIN users u ON u.id = dp.user_id AND u.status = 'active'
           JOIN LATERAL (
             SELECT v.* FROM vehicles v
              WHERE ${vehicleFilters.join(' AND ')}
              ORDER BY (v.id = dp.active_vehicle_id) DESC, v.created_at
              LIMIT 1
           ) v ON true
           JOIN vehicle_categories c ON c.code = v.category_code
           LEFT JOIN LATERAL (
             SELECT sp.entitlements->>'badge' AS badge, (sp.entitlements->>'priorityInSearch')::boolean AS priority
               FROM driver_subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
              WHERE s.driver_profile_id = dp.id AND s.status = 'active' AND s.current_period_end > now()
              LIMIT 1
           ) plan ON true
          WHERE ${where.join(' AND ')}
       ) listing
       ${q.verifiedOnly === false ? '' : 'WHERE docs_ok'}
       ORDER BY ${order[q.sort ?? DriverSort.Recommended]}, driver_id
       LIMIT ${w.limit} OFFSET ${w.offset}`,
      params,
    );

    const categories = await this.catalog.categoryMap();
    const items = await Promise.all(rows.map((r) => this.toListing(r, categories)));
    return paginated(items, rows[0]?.total ?? 0, w);
  }

  async profile(driverId: string, from: LatLng | null): Promise<DriverPublicProfile> {
    const params: unknown[] = [driverId, [...REQUIRED_VEHICLE_DOCUMENT_TYPES]];
    const freshSql = `(dp.location_updated_at IS NOT NULL AND dp.location_updated_at >= now() - make_interval(secs => ${LOCATION_RECENT_MAX_AGE_SECONDS}))`;
    let pointSql: string | null = null;
    if (from) {
      params.push(from.lng, from.lat);
      pointSql = `ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography`;
    }
    const row = await this.db.one<ListingRow & { vehicles: VehicleRow[] }>(
      `SELECT dp.id AS driver_id, dp.display_name, dp.photo_key, dp.languages, dp.years_experience,
              dp.completed_trips, dp.accepted_bookings, dp.cancelled_bookings, dp.rating_average, dp.rating_count,
              dp.service_areas, dp.availability, dp.location_updated_at, dp.bio, dp.partner_type,
              dp.operating_hours, dp.created_at,
              (SELECT to_jsonb(v) FROM vehicles v WHERE ${OPERABLE_VEHICLE}
                ORDER BY (v.id = dp.active_vehicle_id) DESC, v.created_at LIMIT 1) AS vehicle,
              COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY (v.id = dp.active_vehicle_id) DESC, v.created_at)
                          FROM vehicles v WHERE ${OPERABLE_VEHICLE}), '[]'::jsonb) AS vehicles,
              EXISTS (SELECT 1 FROM vehicles v WHERE ${OPERABLE_VEHICLE} AND vehicle_documents_ok(v.id, $2)) AS docs_ok,
              EXISTS (SELECT 1 FROM featured_placements fp
                       WHERE fp.driver_profile_id = dp.id AND fp.status IN ('scheduled','active')
                         AND CURRENT_DATE BETWEEN fp.starts_on AND fp.ends_on) AS is_featured,
              (SELECT sp.entitlements->>'badge' FROM driver_subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
                WHERE s.driver_profile_id = dp.id AND s.status = 'active' AND s.current_period_end > now() LIMIT 1) AS plan_badge,
              ${pointSql ? `CASE WHEN ${freshSql} THEN ST_Distance(dp.last_location, ${pointSql}) END` : 'NULL::float8'} AS distance_m,
              ${pointSql ? `CASE WHEN ${freshSql} THEN degrees(ST_Azimuth(${pointSql}, dp.last_location)) END` : 'NULL::float8'} AS bearing_deg
         FROM driver_profiles dp
         JOIN users u ON u.id = dp.user_id AND u.status = 'active'
        WHERE dp.id = $1 AND dp.listing_status = 'published' AND dp.verification_status = 'approved'`,
      params,
    );
    // A profile with nothing bookable is not a listing: same answer as an unknown id.
    if (!row || !row.vehicle) throw AppError.notFound('Driver');

    void this.db.exec(`UPDATE driver_profiles SET profile_views = profile_views + 1 WHERE id = $1`, [driverId]).catch(() => undefined);

    const categories = await this.catalog.categoryMap();
    const listing = await this.toListing(row, categories);
    const vehicles = await Promise.all(
      row.vehicles.map(async (v) =>
        toVehicleSummary(v, categories.get(v.category_code), await this.uploads.publicUrl(v.photo_keys?.[0])),
      ),
    );
    return {
      ...listing,
      bio: row.bio,
      memberSince: isoReq(row.created_at),
      partnerType: row.partner_type,
      vehicles,
      operatingHours: row.operating_hours,
      cancellationRate: cancellationRate(row),
    };
  }

  private async toListing(r: ListingRow, categories: Map<string, CategoryRow>): Promise<DriverListing> {
    const category = categories.get(r.vehicle.category_code);
    const updatedAt = r.location_updated_at ? new Date(r.location_updated_at) : null;
    const freshness = classifyFreshness(updatedAt);
    const fresh = isFresh(freshness) && r.distance_m !== null;
    const location: RelativeLocation = {
      freshness,
      distanceKm: fresh ? roundKm(Number(r.distance_m) / 1000) : null,
      bearingDeg: fresh && r.bearing_deg !== null ? roundBearing(Number(r.bearing_deg)) : null,
      updatedAt: iso(updatedAt),
    };
    return {
      driverId: r.driver_id,
      displayName: r.display_name,
      photoUrl: await this.uploads.publicUrl(r.photo_key),
      isVerified: r.docs_ok,
      isFeatured: r.is_featured,
      planBadge: r.plan_badge,
      rating: { average: numOrNull(r.rating_average), count: r.rating_count },
      languages: r.languages,
      yearsExperience: r.years_experience,
      completedTrips: r.completed_trips,
      vehicle: toVehicleSummary(r.vehicle, category, await this.uploads.publicUrl(r.vehicle.photo_keys?.[0])),
      rates: ratesOf(r.vehicle, category),
      serviceAreas: r.service_areas,
      availability: r.availability,
      location,
    };
  }
}

export { LOCATION_LIVE_MAX_AGE_SECONDS, LocationFreshness };
