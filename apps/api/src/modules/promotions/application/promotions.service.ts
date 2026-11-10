import { Injectable } from '@nestjs/common';
import {
  AdCampaignStatus,
  FeatureFlag,
  type AdCampaign,
  type AdCampaignInput,
  type AdCreative,
  type AdPlacement,
  type PackageArtwork,
  type PackageStop,
  type TourPackage,
  type TourPackageInput,
} from '@payana/contracts';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db, json } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { dateOnly, inr, isoReq } from '../../../common/money.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import { todayInIndia } from '../../marketplace/infrastructure/rows.js';
import { SettingsService } from '../../platform/application/settings.service.js';

interface PackageRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  region_slug: string;
  artwork: PackageArtwork;
  duration_hours: number;
  distance_km: number;
  stops: PackageStop[];
  highlights: string[];
  price_from: { categoryCode: string; priceMinor: number }[];
  best_time: string | null;
  is_active: boolean;
  sort_order: number;
}

interface CampaignRow {
  id: string;
  advertiser_name: string;
  advertiser_contact: string | null;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string;
  cta_url: string;
  placements: AdPlacement[];
  region_slugs: string[];
  starts_on: Date | string;
  ends_on: Date | string;
  status: 'draft' | 'scheduled' | 'paused';
  weight: number;
  impressions: string;
  clicks: string;
  created_at: Date;
}

/** The status shown to administrators: stored intent combined with the calendar. */
export function effectiveCampaignStatus(
  stored: 'draft' | 'scheduled' | 'paused',
  startsOn: string,
  endsOn: string,
  today: string,
): AdCampaignStatus {
  if (stored === 'draft') return AdCampaignStatus.Draft;
  if (endsOn < today) return AdCampaignStatus.Ended;
  if (stored === 'paused') return AdCampaignStatus.Paused;
  return startsOn <= today ? AdCampaignStatus.Running : AdCampaignStatus.Scheduled;
}

/** Sightseeing packages and the platform's own local-business advertisements. */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  // --- packages ----------------------------------------------------------------------

  async listPackages(regionSlug: string | undefined, includeInactive: boolean): Promise<TourPackage[]> {
    if (!includeInactive && !(await this.settings.isEnabled(FeatureFlag.Packages))) return [];
    const where: string[] = [];
    const params: unknown[] = [];
    if (!includeInactive) where.push('is_active');
    if (regionSlug) {
      params.push(regionSlug);
      where.push(`region_slug = $${params.length}`);
    }
    const rows = await this.db.query<PackageRow>(
      `SELECT * FROM tour_packages ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_order, title`,
      params,
    );
    return this.toPackages(rows);
  }

  async getPackage(slug: string): Promise<TourPackage> {
    await this.settings.requireFeature(FeatureFlag.Packages);
    const row = await this.db.one<PackageRow>(`SELECT * FROM tour_packages WHERE slug = $1 AND is_active`, [slug]);
    if (!row) throw AppError.notFound('Package');
    return (await this.toPackages([row]))[0]!;
  }

  /** Used by the bookings module when a request names a package. */
  async findActivePackage(packageId: string): Promise<{ id: string; title: string; regionSlug: string } | null> {
    const row = await this.db.one<PackageRow>(`SELECT * FROM tour_packages WHERE id = $1 AND is_active`, [packageId]);
    return row ? { id: row.id, title: row.title, regionSlug: row.region_slug } : null;
  }

  async createPackage(input: TourPackageInput, actor: AuthUser): Promise<TourPackage> {
    const values = await this.packageValues(input);
    const row = await this.db.tx(async () => {
      const dup = await this.db.one(`SELECT 1 FROM tour_packages WHERE slug = $1`, [input.slug]);
      if (dup) throw AppError.conflict('A package with this slug already exists.');
      const created = await this.db.insert<PackageRow>('tour_packages', values);
      await this.audit.record({ actor, action: 'package.created', targetType: 'tour_package', targetId: created.id, metadata: { slug: created.slug } });
      return created;
    });
    return (await this.toPackages([row]))[0]!;
  }

  async updatePackage(packageId: string, input: TourPackageInput, actor: AuthUser): Promise<TourPackage> {
    const values = await this.packageValues(input);
    const row = await this.db.tx(async () => {
      const existing = await this.db.one<PackageRow>(`SELECT * FROM tour_packages WHERE id = $1 FOR UPDATE`, [packageId]);
      if (!existing) throw AppError.notFound('Package');
      if (existing.slug !== input.slug) {
        const dup = await this.db.one(`SELECT 1 FROM tour_packages WHERE slug = $1 AND id <> $2`, [input.slug, packageId]);
        if (dup) throw AppError.conflict('A package with this slug already exists.');
      }
      const updated = await this.db.update<PackageRow>('tour_packages', { id: packageId }, { ...values, updated_at: new Date() });
      await this.audit.record({ actor, action: 'package.updated', targetType: 'tour_package', targetId: packageId, metadata: { slug: input.slug, isActive: input.isActive } });
      return updated!;
    });
    return (await this.toPackages([row]))[0]!;
  }

  // --- advertisements ------------------------------------------------------------------

  /** Up to three running campaigns for a placement, picked at random in proportion to their weight. */
  async serveAds(placement: AdPlacement, regionSlug: string | undefined): Promise<AdCreative[]> {
    if (!(await this.settings.isEnabled(FeatureFlag.LocalAds))) return [];
    const rows = await this.db.query<CampaignRow>(
      `SELECT * FROM ad_campaigns
        WHERE status = 'scheduled' AND CURRENT_DATE BETWEEN starts_on AND ends_on
          AND $1 = ANY(placements)
          AND (cardinality(region_slugs) = 0 OR $2::text IS NULL OR $2 = ANY(region_slugs))
        ORDER BY -ln(1 - random()) / weight
        LIMIT 3`,
      [placement, regionSlug ?? null],
    );
    return rows.map((c) => ({
      id: c.id,
      advertiserName: c.advertiser_name,
      title: c.title,
      body: c.body,
      imageUrl: c.image_url,
      ctaLabel: c.cta_label,
      ctaUrl: c.cta_url,
      placement,
    }));
  }

  /** Counts only campaigns that are actually running, so stray calls cannot inflate a report. */
  async recordImpression(campaignId: string): Promise<void> {
    await this.db.exec(
      `UPDATE ad_campaigns SET impressions = impressions + 1
        WHERE id = $1 AND status = 'scheduled' AND CURRENT_DATE BETWEEN starts_on AND ends_on`,
      [campaignId],
    );
  }

  async recordClick(campaignId: string): Promise<void> {
    await this.db.exec(
      `UPDATE ad_campaigns SET clicks = clicks + 1
        WHERE id = $1 AND status = 'scheduled' AND CURRENT_DATE BETWEEN starts_on AND ends_on`,
      [campaignId],
    );
  }

  async listCampaigns(): Promise<AdCampaign[]> {
    const rows = await this.db.query<CampaignRow>(`SELECT * FROM ad_campaigns ORDER BY created_at DESC LIMIT 500`);
    return rows.map(toCampaign);
  }

  async createCampaign(input: AdCampaignInput, actor: AuthUser): Promise<AdCampaign> {
    const values = await this.campaignValues(input);
    return this.db.tx(async () => {
      const row = await this.db.insert<CampaignRow>('ad_campaigns', values);
      await this.audit.record({ actor, action: 'ad_campaign.created', targetType: 'ad_campaign', targetId: row.id, metadata: { advertiser: row.advertiser_name, status: row.status } });
      return toCampaign(row);
    });
  }

  async updateCampaign(campaignId: string, input: AdCampaignInput, actor: AuthUser): Promise<AdCampaign> {
    const values = await this.campaignValues(input);
    return this.db.tx(async () => {
      const existing = await this.db.one<CampaignRow>(`SELECT * FROM ad_campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
      if (!existing) throw AppError.notFound('Campaign');
      const row = await this.db.update<CampaignRow>('ad_campaigns', { id: campaignId }, { ...values, updated_at: new Date() });
      await this.audit.record({
        actor,
        action: 'ad_campaign.updated',
        targetType: 'ad_campaign',
        targetId: campaignId,
        metadata: { status: input.status, previousStatus: existing.status },
      });
      return toCampaign(row!);
    });
  }

  // --- internals --------------------------------------------------------------------------

  private async packageValues(input: TourPackageInput): Promise<Record<string, unknown>> {
    await this.catalog.assertRegionSlugs([input.regionSlug], 'regionSlug');
    const categories = await this.catalog.categoryMap();
    for (const [i, p] of input.priceFrom.entries()) {
      if (!categories.has(p.categoryCode)) throw AppError.invalid(`priceFrom.${i}.categoryCode`, 'Unknown vehicle category.');
    }
    return {
      slug: input.slug,
      title: input.title.trim(),
      summary: input.summary.trim(),
      region_slug: input.regionSlug,
      artwork: input.artwork,
      duration_hours: input.durationHours,
      distance_km: input.distanceKm,
      stops: json(input.stops.map((s) => ({ name: s.name.trim(), description: s.description?.trim() || null, durationMinutes: s.durationMinutes }))),
      highlights: input.highlights,
      price_from: json(input.priceFrom.map((p) => ({ categoryCode: p.categoryCode, priceMinor: p.price.amountMinor }))),
      best_time: input.bestTime?.trim() || null,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    };
  }

  private async campaignValues(input: AdCampaignInput): Promise<Record<string, unknown>> {
    if (input.endsOn < input.startsOn) throw AppError.invalid('endsOn', 'The end date must not be before the start date.');
    if (input.regionSlugs.length > 0) await this.catalog.assertRegionSlugs(input.regionSlugs, 'regionSlugs');
    // Only https pages and phone links: an advertisement must never carry a script or data URL.
    if (!/^https:\/\/[^\s]+$/i.test(input.ctaUrl) && !/^tel:\+?[0-9]{6,15}$/.test(input.ctaUrl)) {
      throw AppError.invalid('ctaUrl', 'Use an https:// link or a tel: number.');
    }
    if (input.imageUrl && !/^https:\/\/[^\s]+$/i.test(input.imageUrl)) {
      throw AppError.invalid('imageUrl', 'Use an https:// image link.');
    }
    return {
      advertiser_name: input.advertiserName.trim(),
      advertiser_contact: input.advertiserContact?.trim() || null,
      title: input.title.trim(),
      body: input.body.trim(),
      image_url: input.imageUrl || null,
      cta_label: input.ctaLabel.trim(),
      cta_url: input.ctaUrl,
      placements: [...new Set(input.placements)],
      region_slugs: [...new Set(input.regionSlugs)],
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      status: input.status,
      weight: input.weight,
    };
  }

  private async toPackages(rows: PackageRow[]): Promise<TourPackage[]> {
    const categories = await this.catalog.categoryMap();
    return rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      regionSlug: p.region_slug,
      artwork: p.artwork,
      durationHours: p.duration_hours,
      distanceKm: p.distance_km,
      stops: p.stops,
      highlights: p.highlights,
      priceFrom: p.price_from.map((x) => ({
        categoryCode: x.categoryCode,
        categoryName: categories.get(x.categoryCode)?.name ?? x.categoryCode,
        price: inr(x.priceMinor),
      })),
      bestTime: p.best_time,
      isActive: p.is_active,
      sortOrder: p.sort_order,
    }));
  }
}

function toCampaign(c: CampaignRow): AdCampaign {
  const startsOn = dateOnly(c.starts_on)!;
  const endsOn = dateOnly(c.ends_on)!;
  return {
    id: c.id,
    advertiserName: c.advertiser_name,
    advertiserContact: c.advertiser_contact,
    title: c.title,
    body: c.body,
    imageUrl: c.image_url,
    ctaLabel: c.cta_label,
    ctaUrl: c.cta_url,
    placements: c.placements,
    regionSlugs: c.region_slugs,
    startsOn,
    endsOn,
    status: effectiveCampaignStatus(c.status, startsOn, endsOn, todayInIndia()),
    weight: c.weight,
    stats: { impressions: Number(c.impressions), clicks: Number(c.clicks) },
    createdAt: isoReq(c.created_at),
  };
}
