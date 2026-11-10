import type { IsoDate, IsoDateTime, Money, Uuid } from './common.js';

// ---------------------------------------------------------------------------
// Subscription plans and entitlements
// ---------------------------------------------------------------------------

export const BillingPeriod = {
  Monthly: 'monthly',
  Quarterly: 'quarterly',
  Yearly: 'yearly',
} as const;
export type BillingPeriod = (typeof BillingPeriod)[keyof typeof BillingPeriod];

export interface PlanEntitlements {
  /** Vehicles that may be listed at once. */
  maxVehicles: number;
  /** Quotes the partner may send per month. Null = unlimited. */
  monthlyQuoteLimit: number | null;
  /** Ranked ahead of free listings when otherwise equal. */
  priorityInSearch: boolean;
  /** Featured-listing days included in each billing period. */
  featuredDaysIncluded: number;
  /** Short label shown on the listing, e.g. "Pro". Null = no badge. */
  badge: string | null;
  /** Access to the performance dashboard. */
  analytics: boolean;
}

export interface SubscriptionPlan {
  id: Uuid;
  /** Stable key, e.g. "free", "plus", "pro". */
  code: string;
  name: string;
  description: string;
  price: Money;
  billingPeriod: BillingPeriod;
  entitlements: PlanEntitlements;
  /** Marketing bullet points. */
  highlights: string[];
  /** Emphasised on the pricing page. */
  isRecommended: boolean;
  isActive: boolean;
  sortOrder: number;
}
export type SubscriptionPlanInput = Omit<SubscriptionPlan, 'id'>;

export const SubscriptionStatus = {
  Active: 'active',
  /** Payment started but not yet confirmed. */
  PendingPayment: 'pending_payment',
  /** Past the period end, inside the grace window. */
  PastDue: 'past_due',
  Cancelled: 'cancelled',
  Expired: 'expired',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export interface DriverSubscription {
  id: Uuid;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: IsoDateTime;
  currentPeriodEnd: IsoDateTime;
  /** False once the partner cancels; access continues to the period end. */
  autoRenew: boolean;
  /** Consumption against the plan's limits in the current period. */
  usage: {
    quotesSent: number;
    vehiclesListed: number;
    featuredDaysUsed: number;
  };
}

/** Send with an `Idempotency-Key` header. */
export interface SubscriptionCheckoutRequest {
  planId: Uuid;
}

export const PaymentProvider = {
  /**
   * Development / pilot adapter: no money moves. Checkout completes
   * immediately and the invoice is marked as settled offline.
   */
  Manual: 'manual',
  Razorpay: 'razorpay',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export interface CheckoutSession {
  invoiceId: Uuid;
  provider: PaymentProvider;
  /** "completed" for the manual adapter; "requires_action" for a gateway. */
  status: 'completed' | 'requires_action';
  /** Gateway order reference and public key for the hosted checkout, if any. */
  providerOrderId: string | null;
  providerPublicKey: string | null;
  amount: Money;
}

export const InvoiceStatus = {
  Open: 'open',
  Paid: 'paid',
  Void: 'void',
  Refunded: 'refunded',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export interface Invoice {
  id: Uuid;
  /** e.g. "INV-2026-000042". */
  number: string;
  status: InvoiceStatus;
  description: string;
  amount: Money;
  provider: PaymentProvider;
  issuedAt: IsoDateTime;
  paidAt: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Featured listings
// ---------------------------------------------------------------------------

export interface FeaturedPlacement {
  id: Uuid;
  vehicleId: Uuid;
  regionSlug: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  /** True when drawn from the plan's included days rather than paid for. */
  fromPlanAllowance: boolean;
}

/** Send with an `Idempotency-Key` header. */
export interface PurchaseFeaturedPlacementRequest {
  vehicleId: Uuid;
  regionSlug: string;
  startsOn: IsoDate;
  /** 1 - 30. */
  days: number;
}

// ---------------------------------------------------------------------------
// Sightseeing packages
// ---------------------------------------------------------------------------

/** Artwork keys the clients can draw for a package. */
export const PackageArtwork = {
  Beach: 'beach',
  Temple: 'temple',
  Waterfall: 'waterfall',
  Fort: 'fort',
  Hills: 'hills',
  Backwater: 'backwater',
} as const;
export type PackageArtwork = (typeof PackageArtwork)[keyof typeof PackageArtwork];

export interface PackageStop {
  name: string;
  description: string | null;
  /** Suggested time at the stop. */
  durationMinutes: number;
}

export interface TourPackage {
  id: Uuid;
  slug: string;
  title: string;
  summary: string;
  regionSlug: string;
  artwork: PackageArtwork;
  durationHours: number;
  distanceKm: number;
  stops: PackageStop[];
  highlights: string[];
  /** Lowest typical price per vehicle category. Indicative, not a fare. */
  priceFrom: { categoryCode: string; categoryName: string; price: Money }[];
  bestTime: string | null;
  isActive: boolean;
  sortOrder: number;
}
export type TourPackageInput = Omit<TourPackage, 'id'>;

// ---------------------------------------------------------------------------
// Local business advertisements (the platform's own inventory)
// ---------------------------------------------------------------------------

export const AdPlacement = {
  HomeStrip: 'home_strip',
  SearchInline: 'search_inline',
  BookingConfirmation: 'booking_confirmation',
  PackageDetail: 'package_detail',
} as const;
export type AdPlacement = (typeof AdPlacement)[keyof typeof AdPlacement];

/** What a client needs to draw one advertisement. Always labelled "Sponsored". */
export interface AdCreative {
  /** Campaign id; used for impression and click reporting. */
  id: Uuid;
  advertiserName: string;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string;
  /** https URL, or a tel: link. */
  ctaUrl: string;
  placement: AdPlacement;
}

export const AdCampaignStatus = {
  Draft: 'draft',
  Scheduled: 'scheduled',
  Running: 'running',
  Paused: 'paused',
  Ended: 'ended',
} as const;
export type AdCampaignStatus = (typeof AdCampaignStatus)[keyof typeof AdCampaignStatus];

export interface AdCampaign {
  id: Uuid;
  advertiserName: string;
  advertiserContact: string | null;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string;
  ctaUrl: string;
  placements: AdPlacement[];
  /** Empty = all regions. */
  regionSlugs: string[];
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: AdCampaignStatus;
  /** Relative share of impressions among competing campaigns, 1 - 10. */
  weight: number;
  stats: { impressions: number; clicks: number };
  createdAt: IsoDateTime;
}
export type AdCampaignInput = Omit<AdCampaign, 'id' | 'stats' | 'createdAt' | 'status'> & {
  status: Extract<AdCampaignStatus, 'draft' | 'scheduled' | 'paused'>;
};

// ---------------------------------------------------------------------------
// Booking fee
// ---------------------------------------------------------------------------

/** Platform booking fee configuration. Off at launch. */
export interface BookingFeeSettings {
  enabled: boolean;
  /** Flat component in minor units. */
  flatMinor: number;
  /** Percentage of the quoted fare, 0 - 20. */
  percent: number;
  /** Ceiling on the computed fee in minor units. Null = no ceiling. */
  capMinor: number | null;
}
