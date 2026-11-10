import { Injectable } from '@nestjs/common';
import {
  RegionStatus,
  type FareEstimate,
  type LatLng,
  type PlaceKind,
  type PlaceSearchQuery,
  type PlaceSuggestion,
  type Region,
  type RegionInput,
  type VehicleCategory,
  type VehicleCategoryInput,
  type VehicleIcon,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { inr } from '../../../common/money.js';
import { estimateFare } from '../domain/fare-estimate.js';

interface RegionRow {
  id: string;
  slug: string;
  name: string;
  name_local: string | null;
  state: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  status: RegionStatus;
  tagline: string | null;
  sort_order: number;
}

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: VehicleIcon;
  seats: number;
  luggage_capacity: number;
  base_fare_minor: number;
  per_km_minor: number;
  min_per_km_minor: number;
  max_per_km_minor: number;
  per_hour_waiting_minor: number;
  sort_order: number;
  is_active: boolean;
}

interface PlaceRow {
  id: string;
  label: string;
  address: string | null;
  lat: number;
  lng: number;
  kind: PlaceKind;
  region_slug: string;
}

/**
 * Reference data: regions, curated places, vehicle categories and the
 * indicative fare estimate. Other modules read it only through this service.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // --- regions --------------------------------------------------------------------

  async listRegions(includeHidden = false): Promise<Region[]> {
    const rows = await this.db.query<RegionRow>(
      `SELECT * FROM regions ${includeHidden ? '' : `WHERE status <> 'hidden'`} ORDER BY sort_order, name`,
    );
    return rows.map(toRegion);
  }

  async regionSlugs(): Promise<string[]> {
    return (await this.db.query<{ slug: string }>(`SELECT slug FROM regions`)).map((r) => r.slug);
  }

  /** Throws a validation error naming the first slug that is not a known region. */
  async assertRegionSlugs(slugs: string[], field: string): Promise<void> {
    const known = new Set(await this.regionSlugs());
    const unknown = slugs.find((s) => !known.has(s));
    if (unknown) throw AppError.invalid(field, `"${unknown}" is not a known region.`);
  }

  /** The nearest non-hidden region whose radius contains the point, if any. */
  async regionSlugAt(point: LatLng): Promise<string | null> {
    const row = await this.db.one<{ slug: string }>(
      `SELECT slug FROM regions
        WHERE status <> 'hidden'
          AND ST_DWithin(center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, radius_km * 1000)
        ORDER BY ST_Distance(center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)
        LIMIT 1`,
      [point.lat, point.lng],
    );
    return row?.slug ?? null;
  }

  async isLive(slug: string): Promise<boolean> {
    const row = await this.db.one<{ status: RegionStatus }>(`SELECT status FROM regions WHERE slug = $1`, [slug]);
    return row?.status === RegionStatus.Live;
  }

  async createRegion(input: RegionInput, actor: AuthUser): Promise<Region> {
    return this.db.tx(async () => {
      const dup = await this.db.one(`SELECT 1 FROM regions WHERE slug = $1`, [input.slug]);
      if (dup) throw AppError.conflict('A region with this slug already exists.');
      const row = await this.db.insert<RegionRow>('regions', regionValues(input));
      await this.audit.record({ actor, action: 'region.created', targetType: 'region', targetId: row.id, metadata: { slug: row.slug } });
      return toRegion(row);
    });
  }

  async updateRegion(id: string, input: RegionInput, actor: AuthUser): Promise<Region> {
    return this.db.tx(async () => {
      const existing = await this.db.one<RegionRow>(`SELECT * FROM regions WHERE id = $1 FOR UPDATE`, [id]);
      if (!existing) throw AppError.notFound('Region');
      // The slug is referenced by listings, requests and packages; it is fixed after creation.
      if (input.slug !== existing.slug) throw AppError.invalid('slug', 'The slug of an existing region cannot be changed.');
      const row = await this.db.update<RegionRow>('regions', { id }, { ...regionValues(input), updated_at: new Date() });
      await this.audit.record({
        actor,
        action: 'region.updated',
        targetType: 'region',
        targetId: id,
        metadata: { slug: existing.slug, status: input.status, previousStatus: existing.status },
      });
      return toRegion(row!);
    });
  }

  // --- places ---------------------------------------------------------------------

  async searchPlaces(q: PlaceSearchQuery): Promise<PlaceSuggestion[]> {
    const where = [`p.is_active`, `r.status <> 'hidden'`];
    const params: unknown[] = [];
    if (q.regionSlug) {
      params.push(q.regionSlug);
      where.push(`r.slug = $${params.length}`);
    }
    if (q.q && q.q.trim() !== '') {
      params.push(`%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`p.label ILIKE $${params.length}`);
    }
    const limit = Math.min(q.limit ?? 30, 100);
    const rows = await this.db.query<PlaceRow>(
      `SELECT p.id, p.label, p.address, p.lat, p.lng, p.kind, r.slug AS region_slug
         FROM places p JOIN regions r ON r.id = p.region_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${q.regionSlug ? '' : 'r.sort_order, '}p.sort_order, p.label
        LIMIT ${limit}`,
      params,
    );
    return rows.map((p) => ({
      id: p.id,
      label: p.label,
      address: p.address,
      location: { lat: p.lat, lng: p.lng },
      regionSlug: p.region_slug,
      kind: p.kind,
    }));
  }

  // --- vehicle categories -----------------------------------------------------------

  async listCategories(includeInactive = false): Promise<VehicleCategory[]> {
    const rows = await this.db.query<CategoryRow>(
      `SELECT * FROM vehicle_categories ${includeInactive ? '' : 'WHERE is_active'} ORDER BY sort_order, name`,
    );
    return rows.map(toCategory);
  }

  private categoryCache: { at: number; map: Map<string, CategoryRow> } | null = null;

  /** All categories keyed by code. Cached in-process for a few seconds: six rows read on almost every request. */
  async categoryMap(): Promise<Map<string, CategoryRow>> {
    if (this.categoryCache && Date.now() - this.categoryCache.at < 15_000 && !this.db.inTransaction) return this.categoryCache.map;
    const rows = await this.db.query<CategoryRow>('SELECT * FROM vehicle_categories');
    const map = new Map(rows.map((c) => [c.code, c]));
    if (!this.db.inTransaction) this.categoryCache = { at: Date.now(), map };
    return map;
  }

  async findCategory(code: string): Promise<CategoryRow | null> {
    return this.db.one<CategoryRow>(`SELECT * FROM vehicle_categories WHERE code = $1`, [code]);
  }

  /** Returns the active category or throws a validation error against `field`. */
  async requireActiveCategory(code: string, field = 'categoryCode'): Promise<CategoryRow> {
    const row = await this.findCategory(code);
    if (!row || !row.is_active) throw AppError.invalid(field, 'This vehicle category is not available.');
    return row;
  }

  async createCategory(input: VehicleCategoryInput, actor: AuthUser): Promise<VehicleCategory> {
    assertPricing(input);
    return this.db.tx(async () => {
      const dup = await this.db.one(`SELECT 1 FROM vehicle_categories WHERE code = $1`, [input.code]);
      if (dup) throw AppError.conflict('A vehicle category with this code already exists.');
      const row = await this.db.insert<CategoryRow>('vehicle_categories', categoryValues(input));
      await this.audit.record({ actor, action: 'vehicle_category.created', targetType: 'vehicle_category', targetId: row.id, metadata: { code: row.code } });
      this.categoryCache = null;
      return toCategory(row);
    });
  }

  async updateCategory(id: string, input: VehicleCategoryInput, actor: AuthUser): Promise<VehicleCategory> {
    assertPricing(input);
    return this.db.tx(async () => {
      const existing = await this.db.one<CategoryRow>(`SELECT * FROM vehicle_categories WHERE id = $1 FOR UPDATE`, [id]);
      if (!existing) throw AppError.notFound('Vehicle category');
      if (input.code !== existing.code) throw AppError.invalid('code', 'The code of an existing category cannot be changed.');
      const row = await this.db.update<CategoryRow>('vehicle_categories', { id }, { ...categoryValues(input), updated_at: new Date() });
      await this.audit.record({
        actor,
        action: 'vehicle_category.updated',
        targetType: 'vehicle_category',
        targetId: id,
        metadata: { code: existing.code, pricing: input.pricing, isActive: input.isActive },
      });
      this.categoryCache = null;
      return toCategory(row!);
    });
  }

  // --- estimate ---------------------------------------------------------------------

  async fareEstimate(from: LatLng, to: LatLng, categoryCode: string): Promise<FareEstimate> {
    const category = await this.requireActiveCategory(categoryCode);
    return estimateFare(from, to, {
      baseFareMinor: category.base_fare_minor,
      minPerKmMinor: category.min_per_km_minor,
      maxPerKmMinor: category.max_per_km_minor,
    });
  }
}

function assertPricing(input: VehicleCategoryInput): void {
  const p = input.pricing;
  if (p.minPerKm.amountMinor > p.perKm.amountMinor || p.perKm.amountMinor > p.maxPerKm.amountMinor) {
    throw AppError.invalid('pricing', 'Per-km rates must satisfy minimum <= standard <= maximum.');
  }
}

function regionValues(input: RegionInput): Record<string, unknown> {
  return {
    slug: input.slug,
    name: input.name.trim(),
    name_local: input.nameLocal?.trim() || null,
    state: input.state.trim(),
    center_lat: input.center.lat,
    center_lng: input.center.lng,
    radius_km: input.radiusKm,
    status: input.status,
    tagline: input.tagline?.trim() || null,
  };
}

function categoryValues(input: VehicleCategoryInput): Record<string, unknown> {
  return {
    code: input.code,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    icon: input.icon,
    seats: input.seats,
    luggage_capacity: input.luggageCapacity,
    base_fare_minor: input.pricing.baseFare.amountMinor,
    per_km_minor: input.pricing.perKm.amountMinor,
    min_per_km_minor: input.pricing.minPerKm.amountMinor,
    max_per_km_minor: input.pricing.maxPerKm.amountMinor,
    per_hour_waiting_minor: input.pricing.perHourWaiting.amountMinor,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  };
}

function toRegion(r: RegionRow): Region {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    nameLocal: r.name_local,
    state: r.state,
    center: { lat: r.center_lat, lng: r.center_lng },
    radiusKm: r.radius_km,
    status: r.status,
    tagline: r.tagline,
  };
}

export function toCategory(c: CategoryRow): VehicleCategory {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    icon: c.icon,
    seats: c.seats,
    luggageCapacity: c.luggage_capacity,
    pricing: {
      baseFare: inr(c.base_fare_minor),
      perKm: inr(c.per_km_minor),
      minPerKm: inr(c.min_per_km_minor),
      maxPerKm: inr(c.max_per_km_minor),
      perHourWaiting: inr(c.per_hour_waiting_minor),
    },
    sortOrder: c.sort_order,
    isActive: c.is_active,
  };
}
