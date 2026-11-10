import type { LatLng, Money, Uuid } from './common.js';

/** A town / service area. Adding a market is adding a row, not a release. */
export interface Region {
  id: Uuid;
  /** URL-safe key, e.g. "gokarna". */
  slug: string;
  name: string;
  /** Name in Kannada, shown alongside the English name where space allows. */
  nameLocal: string | null;
  state: string;
  center: LatLng;
  /** Radius around `center` that counts as inside this region. */
  radiusKm: number;
  status: RegionStatus;
  /** One-line description for listings and landing pages. */
  tagline: string | null;
}

export const RegionStatus = {
  /** Accepting searches, requests and driver sign-ups. */
  Live: 'live',
  /** Listed, with driver pre-registration only. */
  ComingSoon: 'coming_soon',
  Hidden: 'hidden',
} as const;
export type RegionStatus = (typeof RegionStatus)[keyof typeof RegionStatus];

/**
 * Icon keys the clients know how to draw. Categories are configurable data,
 * but each one picks its artwork from this fixed set.
 */
export const VehicleIcon = {
  Auto: 'auto',
  Hatchback: 'hatchback',
  Sedan: 'sedan',
  Suv: 'suv',
  TempoTraveller: 'tempo_traveller',
  Bike: 'bike',
} as const;
export type VehicleIcon = (typeof VehicleIcon)[keyof typeof VehicleIcon];

export interface VehicleCategory {
  id: Uuid;
  /** Stable key, e.g. "auto", "sedan", "suv". */
  code: string;
  name: string;
  description: string | null;
  icon: VehicleIcon;
  /** Passenger seats, excluding the driver. */
  seats: number;
  /** Standard cabin bags that fit. */
  luggageCapacity: number;
  /** Platform pricing rules. Driver rates and quotes must stay inside these. */
  pricing: CategoryPricing;
  sortOrder: number;
  isActive: boolean;
}

export interface CategoryPricing {
  baseFare: Money;
  perKm: Money;
  /** Lowest per-km rate a driver may publish. */
  minPerKm: Money;
  /** Highest per-km rate a driver may publish. */
  maxPerKm: Money;
  perHourWaiting: Money;
}

/**
 * A non-binding estimate shown before quotes arrive. Always presented to the
 * customer as a range and labelled "estimate" - the quote is the price.
 */
export interface FareEstimate {
  distanceKm: number;
  durationMinutes: number;
  low: Money;
  high: Money;
  /** How the distance was derived. "straight_line" is a rough approximation. */
  basis: 'route' | 'straight_line';
}

// ---------------------------------------------------------------------------
// Places (curated pickup / drop points)
// ---------------------------------------------------------------------------

export const PlaceKind = {
  Transport: 'transport',
  Beach: 'beach',
  Temple: 'temple',
  Town: 'town',
  Landmark: 'landmark',
} as const;
export type PlaceKind = (typeof PlaceKind)[keyof typeof PlaceKind];

/**
 * A well-known point a customer can pick as pickup or drop without typing an
 * address: bus stands, railway stations, beaches, temples, town centres.
 * Curated per region by administrators (data, not code). A full geocoder is a
 * later integration behind the same shape.
 */
export interface PlaceSuggestion {
  id: Uuid;
  label: string;
  address: string | null;
  location: LatLng;
  regionSlug: string;
  kind: PlaceKind;
}

export interface PlaceSearchQuery {
  regionSlug?: string;
  /** Case-insensitive match on the label. */
  q?: string;
  /** Default 30, maximum 100. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Admin inputs (POST / PUT /admin/regions, /admin/vehicle-categories)
// ---------------------------------------------------------------------------

/** Body for creating or replacing a region. `slug` is fixed once created. */
export type RegionInput = Omit<Region, 'id'>;

/** Body for creating or replacing a vehicle category. `code` is fixed once created. */
export type VehicleCategoryInput = Omit<VehicleCategory, 'id'>;
