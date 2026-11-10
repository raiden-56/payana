import {
  ADSENSE_PUBLISHER_ID_PATTERN,
  ADSENSE_SLOT_ID_PATTERN,
  AdPlacement,
  ConversionEvent,
  FeatureFlag,
  GA4_MEASUREMENT_ID_PATTERN,
  GOOGLE_ADS_CONVERSION_LABEL_PATTERN,
  GOOGLE_ADS_ID_PATTERN,
  INDIAN_MOBILE_E164,
  type AnalyticsSettings,
  type BookingFeeSettings,
  type FeatureFlags,
  type FieldError,
  type PlatformSettings,
  type PlatformSettingsUpdate,
  type SupportContact,
} from '@payana/contracts';
import { AppError } from '../../../common/errors/app-error.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Errors = FieldError[];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An identifier is valid when empty (integration off) or when it matches its pattern. */
function idField(errors: Errors, field: string, value: unknown, pattern: RegExp, example: string): string {
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be a string.' });
    return '';
  }
  const trimmed = value.trim();
  if (trimmed !== '' && !pattern.test(trimmed)) {
    errors.push({ field, message: `Must look like ${example}, or be empty to switch this off.` });
  }
  return trimmed;
}

export function validateAnalytics(input: unknown, current: AnalyticsSettings, errors: Errors): AnalyticsSettings {
  if (!isRecord(input)) {
    errors.push({ field: 'analytics', message: 'Must be an object.' });
    return current;
  }
  const merged = { ...current, ...input } as Record<string, unknown>;
  const out: AnalyticsSettings = {
    ga4MeasurementId: idField(errors, 'analytics.ga4MeasurementId', merged.ga4MeasurementId, GA4_MEASUREMENT_ID_PATTERN, 'G-AB12CD34EF'),
    googleAdsId: idField(errors, 'analytics.googleAdsId', merged.googleAdsId, GOOGLE_ADS_ID_PATTERN, 'AW-1234567890'),
    googleAdsConversionLabels: {},
    adsensePublisherId: idField(
      errors,
      'analytics.adsensePublisherId',
      merged.adsensePublisherId,
      ADSENSE_PUBLISHER_ID_PATTERN,
      'ca-pub-1234567890123456',
    ),
    adsenseSlots: {},
    requireConsent: current.requireConsent,
    debugMode: current.debugMode,
  };

  const labels = merged.googleAdsConversionLabels;
  if (!isRecord(labels)) {
    errors.push({ field: 'analytics.googleAdsConversionLabels', message: 'Must be an object.' });
  } else {
    const events = Object.values(ConversionEvent) as string[];
    for (const [event, label] of Object.entries(labels)) {
      const field = `analytics.googleAdsConversionLabels.${event}`;
      if (!events.includes(event)) {
        errors.push({ field, message: 'Unknown conversion event.' });
        continue;
      }
      const value = idField(errors, field, label, GOOGLE_ADS_CONVERSION_LABEL_PATTERN, 'AbC-D_efG-h12_34-567');
      if (value !== '') out.googleAdsConversionLabels[event as ConversionEvent] = value;
    }
  }

  const slots = merged.adsenseSlots;
  if (!isRecord(slots)) {
    errors.push({ field: 'analytics.adsenseSlots', message: 'Must be an object.' });
  } else {
    const placements = Object.values(AdPlacement) as string[];
    for (const [placement, slot] of Object.entries(slots)) {
      const field = `analytics.adsenseSlots.${placement}`;
      if (!placements.includes(placement)) {
        errors.push({ field, message: 'Unknown placement.' });
        continue;
      }
      const value = idField(errors, field, slot, ADSENSE_SLOT_ID_PATTERN, '1234567890');
      if (value !== '') out.adsenseSlots[placement as AdPlacement] = value;
    }
  }

  for (const key of ['requireConsent', 'debugMode'] as const) {
    if (typeof merged[key] !== 'boolean') errors.push({ field: `analytics.${key}`, message: 'Must be true or false.' });
    else out[key] = merged[key];
  }
  return out;
}

export function validateFeatures(input: unknown, current: FeatureFlags, errors: Errors): FeatureFlags {
  if (!isRecord(input)) {
    errors.push({ field: 'features', message: 'Must be an object.' });
    return current;
  }
  const known = Object.values(FeatureFlag) as string[];
  const out = { ...current };
  for (const [flag, value] of Object.entries(input)) {
    if (!known.includes(flag)) errors.push({ field: `features.${flag}`, message: 'Unknown feature flag.' });
    else if (typeof value !== 'boolean') errors.push({ field: `features.${flag}`, message: 'Must be true or false.' });
    else out[flag as FeatureFlag] = value;
  }
  return out;
}

export function validateSupport(input: unknown, current: SupportContact, errors: Errors): SupportContact {
  if (!isRecord(input)) {
    errors.push({ field: 'support', message: 'Must be an object.' });
    return current;
  }
  const merged = { ...current, ...input } as Record<string, unknown>;
  const out: SupportContact = { ...current };
  for (const key of ['phone', 'whatsapp'] as const) {
    const v = merged[key];
    if (typeof v !== 'string') errors.push({ field: `support.${key}`, message: 'Must be a string.' });
    else if (v.trim() !== '' && !INDIAN_MOBILE_E164.test(v.trim())) {
      errors.push({ field: `support.${key}`, message: 'Must be an Indian mobile number in the form +91XXXXXXXXXX, or empty.' });
    } else out[key] = v.trim();
  }
  const email = merged.email;
  if (typeof email !== 'string') errors.push({ field: 'support.email', message: 'Must be a string.' });
  else if (email.trim() !== '' && !EMAIL.test(email.trim())) {
    errors.push({ field: 'support.email', message: 'Must be an email address, or empty.' });
  } else out.email = email.trim();
  return out;
}

export function validateBookingFee(input: unknown, current: BookingFeeSettings, errors: Errors): BookingFeeSettings {
  if (!isRecord(input)) {
    errors.push({ field: 'bookingFee', message: 'Must be an object.' });
    return current;
  }
  const merged = { ...current, ...input } as Record<string, unknown>;
  const out: BookingFeeSettings = { ...current };
  if (typeof merged.enabled !== 'boolean') errors.push({ field: 'bookingFee.enabled', message: 'Must be true or false.' });
  else out.enabled = merged.enabled;

  const flat = merged.flatMinor;
  if (typeof flat !== 'number' || !Number.isInteger(flat) || flat < 0 || flat > 100_000) {
    errors.push({ field: 'bookingFee.flatMinor', message: 'Must be a whole number of paise between 0 and 100000.' });
  } else out.flatMinor = flat;

  const percent = merged.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 20) {
    errors.push({ field: 'bookingFee.percent', message: 'Must be between 0 and 20.' });
  } else out.percent = percent;

  const cap = merged.capMinor;
  if (cap === null || cap === undefined) out.capMinor = null;
  else if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0) {
    errors.push({ field: 'bookingFee.capMinor', message: 'Must be a whole number of paise, or null for no cap.' });
  } else out.capMinor = cap;
  return out;
}

/**
 * Applies a partial update to the current settings and returns the result,
 * or throws a validation error listing every invalid field.
 */
export function validateSettingsUpdate(
  current: PlatformSettings,
  update: PlatformSettingsUpdate,
  regionSlugs: string[],
): PlatformSettings {
  const errors: Errors = [];
  if (!isRecord(update)) throw AppError.invalid('', 'Body must be an object.');
  const allowed = ['analytics', 'features', 'support', 'bookingFee', 'defaultRegionSlug'];
  for (const key of Object.keys(update)) {
    if (!allowed.includes(key)) errors.push({ field: key, message: 'Unknown settings section.' });
  }
  const next: PlatformSettings = { ...current };
  if (update.analytics !== undefined) next.analytics = validateAnalytics(update.analytics, current.analytics, errors);
  if (update.features !== undefined) next.features = validateFeatures(update.features, current.features, errors);
  if (update.support !== undefined) next.support = validateSupport(update.support, current.support, errors);
  if (update.bookingFee !== undefined) next.bookingFee = validateBookingFee(update.bookingFee, current.bookingFee, errors);
  if (update.defaultRegionSlug !== undefined) {
    if (typeof update.defaultRegionSlug !== 'string' || !regionSlugs.includes(update.defaultRegionSlug)) {
      errors.push({ field: 'defaultRegionSlug', message: 'Must be the slug of an existing region.' });
    } else next.defaultRegionSlug = update.defaultRegionSlug;
  }
  if (errors.length > 0) throw AppError.validation(errors);
  return next;
}
