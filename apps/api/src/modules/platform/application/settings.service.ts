import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_FEATURE_FLAGS,
  EMPTY_ANALYTICS_SETTINGS,
  FeatureFlag,
  type BookingFeeSettings,
  type PlatformSettings,
  type PlatformSettingsUpdate,
  type PublicConfig,
} from '@payana/contracts';
import type { Redis } from 'ioredis';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthUser } from '../../../common/auth/auth.types.js';
import { Db, json } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { REDIS } from '../../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { ErrorCode } from '@payana/contracts';
import { validateSettingsUpdate } from '../domain/settings-rules.js';

export const DEFAULT_BOOKING_FEE: BookingFeeSettings = { enabled: false, flatMinor: 0, percent: 0, capMinor: null };

export const DEFAULT_SETTINGS: PlatformSettings = {
  analytics: EMPTY_ANALYTICS_SETTINGS,
  features: DEFAULT_FEATURE_FLAGS,
  support: { phone: '', whatsapp: '', email: '' },
  bookingFee: DEFAULT_BOOKING_FEE,
  defaultRegionSlug: 'gokarna',
};

const CACHE_KEY = 'settings:v1';
const CACHE_TTL_SECONDS = 30;
const SECTIONS = ['analytics', 'features', 'support', 'bookingFee', 'defaultRegionSlug'] as const;

/**
 * Editable platform configuration, stored one row per section in
 * `platform_settings` and merged over code defaults - so a section added in a
 * later release has a sane value before anyone saves it.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(): Promise<PlatformSettings> {
    if (!this.db.inTransaction) {
      const cached = await this.redis.get(CACHE_KEY).catch(() => null);
      if (cached) return JSON.parse(cached) as PlatformSettings;
    }
    const settings = await this.load();
    if (!this.db.inTransaction) {
      await this.redis.set(CACHE_KEY, JSON.stringify(settings), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
    }
    return settings;
  }

  async getPublicConfig(): Promise<PublicConfig> {
    const s = await this.get();
    return {
      appName: this.config.appName,
      environment: this.config.nodeEnv,
      analytics: s.analytics,
      features: s.features,
      support: s.support,
      bookingFee: s.bookingFee,
      defaultRegionSlug: s.defaultRegionSlug,
    };
  }

  async isEnabled(flag: FeatureFlag): Promise<boolean> {
    return (await this.get()).features[flag] === true;
  }

  async requireFeature(flag: FeatureFlag): Promise<void> {
    if (!(await this.isEnabled(flag))) {
      throw new AppError(403, ErrorCode.FeatureDisabled, 'Feature unavailable', 'This feature is currently switched off.');
    }
  }

  async update(update: PlatformSettingsUpdate, actor: AuthUser): Promise<PlatformSettings> {
    const current = await this.load();
    const regions = await this.db.query<{ slug: string }>(`SELECT slug FROM regions`);
    const next = validateSettingsUpdate(current, update, regions.map((r) => r.slug));

    const changed = SECTIONS.filter((s) => JSON.stringify(current[s]) !== JSON.stringify(next[s]));
    await this.db.tx(async () => {
      for (const section of changed) {
        await this.db.exec(
          `INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [section, JSON.stringify(next[section]), actor.id],
        );
      }
      if (changed.length > 0) {
        await this.audit.record({
          actor,
          action: 'settings.updated',
          targetType: 'platform_settings',
          // Identifiers here are public by design (they ship in page source), so recording them is safe.
          metadata: { sections: changed, analytics: changed.includes('analytics') ? next.analytics : undefined },
        });
      }
    });
    await this.redis.del(CACHE_KEY).catch(() => undefined);
    return next;
  }

  private async load(): Promise<PlatformSettings> {
    const rows = await this.db.query<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings`);
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const pick = <K extends keyof PlatformSettings>(key: K): PlatformSettings[K] => {
      const value = stored.get(key);
      const fallback = DEFAULT_SETTINGS[key];
      if (value === undefined || value === null) return fallback;
      if (typeof fallback === 'object' && fallback !== null) {
        return { ...(fallback as object), ...(value as object) } as PlatformSettings[K];
      }
      return value as PlatformSettings[K];
    };
    return {
      analytics: pick('analytics'),
      features: pick('features'),
      support: pick('support'),
      bookingFee: pick('bookingFee'),
      defaultRegionSlug: pick('defaultRegionSlug'),
    };
  }
}

export { json };
