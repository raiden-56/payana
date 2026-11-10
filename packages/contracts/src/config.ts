import type { AdPlacement, BookingFeeSettings } from './commerce.js';

// ---------------------------------------------------------------------------
// Google Analytics / Google Ads settings
// ---------------------------------------------------------------------------

/**
 * The business moments reported to Google Ads as conversions. Each one maps to
 * a "conversion action" created in the Google Ads account; that action's
 * label goes in `AnalyticsSettings.googleAdsConversionLabels`.
 */
export const ConversionEvent = {
  /** A new customer verified their phone number. */
  CustomerSignUp: 'customer_sign_up',
  /** A customer sent a ride request. */
  RideRequested: 'ride_requested',
  /** A customer accepted a quote - a booking exists. */
  BookingConfirmed: 'booking_confirmed',
  /** A new driver / owner verified their phone number. */
  DriverSignUp: 'driver_sign_up',
  /** A driver bought a paid plan. */
  SubscriptionPurchased: 'subscription_purchased',
} as const;
export type ConversionEvent = (typeof ConversionEvent)[keyof typeof ConversionEvent];

/** GA4 measurement id, e.g. "G-AB12CD34EF". */
export const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,14}$/;
/** Google Ads tag id, e.g. "AW-1234567890". */
export const GOOGLE_ADS_ID_PATTERN = /^AW-\d{8,12}$/;
/** Conversion label as shown in the Google Ads "event snippet", after the slash. */
export const GOOGLE_ADS_CONVERSION_LABEL_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;
/** AdSense publisher id, e.g. "ca-pub-1234567890123456". */
export const ADSENSE_PUBLISHER_ID_PATTERN = /^ca-pub-\d{10,20}$/;
/** AdSense ad-unit slot id. */
export const ADSENSE_SLOT_ID_PATTERN = /^\d{6,14}$/;

/**
 * Everything the clients need to switch Google measurement and advertising on.
 *
 * Every identifier is an empty string until the owner supplies it. An empty
 * identifier means "this integration is off": no script is requested and no
 * data is sent. Nothing here is a secret - these values are public by design
 * and appear in the page source of any site that uses them.
 */
export interface AnalyticsSettings {
  /** Google Analytics 4 measurement id ("G-..."). Empty = analytics off. */
  ga4MeasurementId: string;
  /** Google Ads tag id ("AW-..."). Empty = Ads conversion tracking off. */
  googleAdsId: string;
  /** Conversion label per business event. Missing / empty = that event is not sent to Ads. */
  googleAdsConversionLabels: Partial<Record<ConversionEvent, string>>;
  /** Google AdSense publisher id ("ca-pub-..."). Empty = no Google display ads. */
  adsensePublisherId: string;
  /** AdSense ad-unit slot id per on-page placement. */
  adsenseSlots: Partial<Record<AdPlacement, string>>;
  /**
   * When true (the default, and the only lawful setting for most audiences)
   * nothing is measured until the visitor accepts in the consent banner.
   */
  requireConsent: boolean;
  /** Sends events to GA4 DebugView. Keep off in production. */
  debugMode: boolean;
}

export const EMPTY_ANALYTICS_SETTINGS: AnalyticsSettings = {
  ga4MeasurementId: '',
  googleAdsId: '',
  googleAdsConversionLabels: {},
  adsensePublisherId: '',
  adsenseSlots: {},
  requireConsent: true,
  debugMode: false,
};

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const FeatureFlag = {
  /** Customers can request sightseeing packages. */
  Packages: 'packages',
  /** Drivers can buy paid plans. */
  Subscriptions: 'subscriptions',
  /** Drivers can buy featured placements. */
  FeaturedListings: 'featured_listings',
  /** Local business advertisements are shown. */
  LocalAds: 'local_ads',
  /** Reviews can be submitted and are displayed. */
  Reviews: 'reviews',
  /** Outstation requests are accepted. */
  Outstation: 'outstation',
  /** New driver sign-ups are accepted. */
  DriverSignUp: 'driver_sign_up',
} as const;
export type FeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];

export type FeatureFlags = Record<FeatureFlag, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  [FeatureFlag.Packages]: true,
  [FeatureFlag.Subscriptions]: true,
  [FeatureFlag.FeaturedListings]: true,
  [FeatureFlag.LocalAds]: true,
  [FeatureFlag.Reviews]: true,
  [FeatureFlag.Outstation]: true,
  [FeatureFlag.DriverSignUp]: true,
};

// ---------------------------------------------------------------------------
// Public configuration (GET /public/config, unauthenticated, cacheable)
// ---------------------------------------------------------------------------

export interface SupportContact {
  /** E.164, or empty until set. */
  phone: string;
  /** WhatsApp number in E.164, or empty. */
  whatsapp: string;
  email: string;
}

export interface PublicConfig {
  appName: string;
  /** "production", "staging" or "development". */
  environment: string;
  analytics: AnalyticsSettings;
  features: FeatureFlags;
  support: SupportContact;
  bookingFee: BookingFeeSettings;
  /** Region shown first to a visitor with no location. */
  defaultRegionSlug: string;
}

/**
 * The editable subset of configuration (GET/PUT /admin/settings).
 * Reading needs `settings.read`; writing needs `settings.manage`.
 */
export interface PlatformSettings {
  analytics: AnalyticsSettings;
  features: FeatureFlags;
  support: SupportContact;
  bookingFee: BookingFeeSettings;
  defaultRegionSlug: string;
}
export type PlatformSettingsUpdate = Partial<PlatformSettings>;
