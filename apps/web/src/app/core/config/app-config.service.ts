import { Injectable, computed, signal } from '@angular/core';
import {
  API_PREFIX,
  ApiRoutes,
  DEFAULT_FEATURE_FLAGS,
  EMPTY_ANALYTICS_SETTINGS,
  type AnalyticsSettings,
  type FeatureFlag,
  type PublicConfig,
} from '@payana/contracts';
import { BRAND } from '../brand';

/** Shape of /app-config.json (the static, editable-without-rebuild file). */
interface StaticConfig {
  apiBaseUrl?: string;
  analytics?: Partial<AnalyticsSettings>;
}

export type ConfigSource = 'defaults' | 'static-file' | 'api';

const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  appName: BRAND.name,
  environment: 'development',
  analytics: EMPTY_ANALYTICS_SETTINGS,
  features: DEFAULT_FEATURE_FLAGS,
  support: { phone: '', whatsapp: '', email: '' },
  bookingFee: { enabled: false, flatMinor: 0, percent: 0, capMinor: null },
  defaultRegionSlug: 'gokarna',
};

/**
 * Runtime configuration.
 *
 * Two sources are merged at start-up:
 *   1. /app-config.json - a static file served with the app.
 *   2. GET /public/config - what administrators saved in Admin -> Settings.
 *
 * For Google Analytics / Ads identifiers the admin value wins; an identifier
 * left empty there falls back to the static file. If the API cannot be
 * reached the app still starts, on the static file alone.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly state = signal<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  private staticAnalytics: AnalyticsSettings = EMPTY_ANALYTICS_SETTINGS;

  /** Base URL of the API, e.g. "/api/v1". Fixed once load() has run. */
  apiBaseUrl: string = API_PREFIX;

  readonly source = signal<ConfigSource>('defaults');
  readonly config = this.state.asReadonly();
  readonly analytics = computed(() => this.state().analytics);
  readonly features = computed(() => this.state().features);
  readonly support = computed(() => this.state().support);
  readonly bookingFee = computed(() => this.state().bookingFee);
  readonly isProduction = computed(() => this.state().environment === 'production');

  isEnabled(flag: FeatureFlag): boolean {
    return this.state().features[flag] ?? false;
  }

  /** Runs once before the app renders. Never throws. */
  async load(): Promise<void> {
    const fromFile = await fetchJson<StaticConfig>('/app-config.json', 2500);
    if (fromFile) {
      this.apiBaseUrl = (fromFile.apiBaseUrl ?? API_PREFIX).replace(/\/+$/, '');
      this.staticAnalytics = normaliseAnalytics(fromFile.analytics);
      this.state.update((c) => ({ ...c, analytics: this.staticAnalytics }));
      this.source.set('static-file');
    }

    const fromApi = await fetchJson<PublicConfig>(this.apiBaseUrl + ApiRoutes.public.config, 3500);
    if (fromApi) {
      this.applyPublicConfig(fromApi);
      this.source.set('api');
    }
  }

  /** Also called after an administrator saves settings, so changes apply without a reload. */
  applyPublicConfig(next: Partial<PublicConfig>): void {
    this.state.update((current) => ({
      ...current,
      ...next,
      features: { ...DEFAULT_FEATURE_FLAGS, ...(next.features ?? current.features) },
      analytics: mergeAnalytics(normaliseAnalytics(next.analytics ?? current.analytics), this.staticAnalytics),
    }));
  }
}

/** Admin-entered values win; anything left empty falls back to the static file. */
export function mergeAnalytics(primary: AnalyticsSettings, fallback: AnalyticsSettings): AnalyticsSettings {
  return {
    ga4MeasurementId: primary.ga4MeasurementId || fallback.ga4MeasurementId,
    googleAdsId: primary.googleAdsId || fallback.googleAdsId,
    googleAdsConversionLabels: mergeRecord(
      primary.googleAdsConversionLabels,
      fallback.googleAdsConversionLabels,
    ),
    adsensePublisherId: primary.adsensePublisherId || fallback.adsensePublisherId,
    adsenseSlots: mergeRecord(primary.adsenseSlots, fallback.adsenseSlots),
    // Consent can be relaxed only by an explicit false from the primary source.
    requireConsent: primary.requireConsent,
    debugMode: primary.debugMode || fallback.debugMode,
  };
}

function mergeRecord<K extends string>(
  primary: Partial<Record<K, string>>,
  fallback: Partial<Record<K, string>>,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  const keys = new Set([...Object.keys(fallback), ...Object.keys(primary)] as K[]);
  for (const key of keys) {
    const value = (primary[key] || fallback[key] || '').trim();
    if (value) out[key] = value;
  }
  return out;
}

export function normaliseAnalytics(input: Partial<AnalyticsSettings> | undefined): AnalyticsSettings {
  const a = input ?? {};
  return {
    ga4MeasurementId: (a.ga4MeasurementId ?? '').trim(),
    googleAdsId: (a.googleAdsId ?? '').trim(),
    googleAdsConversionLabels: { ...(a.googleAdsConversionLabels ?? {}) },
    adsensePublisherId: (a.adsensePublisherId ?? '').trim(),
    adsenseSlots: { ...(a.adsenseSlots ?? {}) },
    requireConsent: a.requireConsent ?? true,
    debugMode: a.debugMode ?? false,
  };
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
