import type { IsoDate, IsoDateTime, LatLng, Money, PageQuery, Uuid } from './common.js';
import type { VehicleIcon } from './catalog.js';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const PartnerType = {
  /** Owns and drives their own vehicle. */
  OwnerDriver: 'owner_driver',
  /** Owns one or more vehicles driven by others. */
  FleetOwner: 'fleet_owner',
  /** Drives a vehicle registered to someone else, under an authorisation. */
  HiredDriver: 'hired_driver',
} as const;
export type PartnerType = (typeof PartnerType)[keyof typeof PartnerType];

export const VerificationStatus = {
  /** Profile started, required documents not yet all submitted. */
  Incomplete: 'incomplete',
  /** Submitted and waiting for a verification officer. */
  Pending: 'pending',
  Approved: 'approved',
  /** At least one document rejected; the partner must resubmit. */
  ChangesRequested: 'changes_requested',
  Rejected: 'rejected',
  Suspended: 'suspended',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const DocumentType = {
  Identity: 'identity',
  DrivingLicence: 'driving_licence',
  VehicleRegistration: 'vehicle_registration',
  Insurance: 'insurance',
  Permit: 'permit',
  Fitness: 'fitness',
  PollutionCertificate: 'pollution_certificate',
  /** Owner's signed consent letting a hired driver operate the vehicle. */
  OwnerAuthorisation: 'owner_authorisation',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

/** Documents about the person. The rest are about a vehicle. */
export const PERSON_DOCUMENT_TYPES: readonly DocumentType[] = [
  DocumentType.Identity,
  DocumentType.DrivingLicence,
];

/** Vehicle documents that must be approved and unexpired to take bookings. */
export const REQUIRED_VEHICLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  DocumentType.VehicleRegistration,
  DocumentType.Insurance,
  DocumentType.Permit,
  DocumentType.Fitness,
];

export const DocumentStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Expired: 'expired',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const DocumentRejectionReason = {
  Unreadable: 'unreadable',
  Expired: 'expired',
  NameMismatch: 'name_mismatch',
  NumberMismatch: 'number_mismatch',
  WrongDocument: 'wrong_document',
  SuspectedForgery: 'suspected_forgery',
  Other: 'other',
} as const;
export type DocumentRejectionReason =
  (typeof DocumentRejectionReason)[keyof typeof DocumentRejectionReason];

export const AvailabilityStatus = {
  Available: 'available',
  Busy: 'busy',
  Offline: 'offline',
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

/**
 * How much the platform trusts a driver's last reported position.
 * live   - under 2 minutes old
 * recent - under 15 minutes old
 * stale  - older; distance is NOT shown as current
 * unknown - never reported
 */
export const LocationFreshness = {
  Live: 'live',
  Recent: 'recent',
  Stale: 'stale',
  Unknown: 'unknown',
} as const;
export type LocationFreshness = (typeof LocationFreshness)[keyof typeof LocationFreshness];

export const LOCATION_LIVE_MAX_AGE_SECONDS = 120;
export const LOCATION_RECENT_MAX_AGE_SECONDS = 900;

export const ListingStatus = {
  /** Visible in search. */
  Published: 'published',
  /** Not yet approved, or the partner paused it. */
  Unlisted: 'unlisted',
  /** Taken down by an administrator. */
  Suspended: 'suspended',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

// ---------------------------------------------------------------------------
// Public discovery
// ---------------------------------------------------------------------------

export interface RatingSummary {
  /** 1.0 - 5.0, one decimal. Null until the first review. */
  average: number | null;
  count: number;
}

export interface VehicleSummary {
  id: Uuid;
  categoryCode: string;
  categoryName: string;
  icon: VehicleIcon;
  make: string;
  model: string;
  color: string | null;
  seats: number;
  luggageCapacity: number;
  hasAc: boolean;
  /** e.g. "KA 47 •• 4821". The full plate is shown only inside a booking. */
  registrationMasked: string;
  photoUrl: string | null;
}

export interface IndicativeRates {
  baseFare: Money;
  perKm: Money;
  perHourWaiting: Money;
  /** Full-day local hire (8 h / 80 km), when the driver offers one. */
  fullDay: Money | null;
}

/**
 * Where a driver is relative to the search point. Exact coordinates are never
 * returned to the public - only distance and a compass bearing.
 */
export interface RelativeLocation {
  freshness: LocationFreshness;
  /** Null when freshness is "stale" or "unknown". */
  distanceKm: number | null;
  /** Degrees clockwise from north, rounded to 10. Null when distance is null. */
  bearingDeg: number | null;
  updatedAt: IsoDateTime | null;
}

export interface DriverListing {
  driverId: Uuid;
  displayName: string;
  photoUrl: string | null;
  isVerified: boolean;
  /** Paid featured placement currently active. Always labelled in the UI. */
  isFeatured: boolean;
  /** Plan badge, e.g. "Pro". Null on the free tier. */
  planBadge: string | null;
  rating: RatingSummary;
  languages: string[];
  yearsExperience: number | null;
  completedTrips: number;
  vehicle: VehicleSummary;
  rates: IndicativeRates;
  /** Region slugs the driver serves. */
  serviceAreas: string[];
  availability: AvailabilityStatus;
  location: RelativeLocation;
}

export const DriverSort = {
  Recommended: 'recommended',
  Nearest: 'nearest',
  Rating: 'rating',
  Price: 'price',
} as const;
export type DriverSort = (typeof DriverSort)[keyof typeof DriverSort];

export interface DriverSearchQuery extends PageQuery {
  /** Search point. When omitted, results are region-wide and unsorted by distance. */
  lat?: number;
  lng?: number;
  /** 1 - 50. Default 10. */
  radiusKm?: number;
  regionSlug?: string;
  categoryCode?: string;
  minSeats?: number;
  /** Default true. */
  verifiedOnly?: boolean;
  /** Only drivers currently marked available. Default false. */
  availableNow?: boolean;
  sort?: DriverSort;
}

export const DEFAULT_SEARCH_RADIUS_KM = 10;
export const MAX_SEARCH_RADIUS_KM = 50;

export interface DriverPublicProfile extends DriverListing {
  bio: string | null;
  memberSince: IsoDateTime;
  partnerType: PartnerType;
  /** All published vehicles; `vehicle` above is the primary one. */
  vehicles: VehicleSummary[];
  operatingHours: OperatingHours | null;
  /** Share of accepted bookings the driver cancelled, 0-1. Null under 5 bookings. */
  cancellationRate: number | null;
}

// ---------------------------------------------------------------------------
// Partner (driver / owner) self-service
// ---------------------------------------------------------------------------

export interface OperatingHours {
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** Local time "HH:mm", 24-hour. */
  from: string;
  to: string;
}

export interface DriverProfile {
  id: Uuid;
  userId: Uuid;
  partnerType: PartnerType;
  displayName: string;
  bio: string | null;
  photoUrl: string | null;
  languages: string[];
  yearsExperience: number | null;
  serviceAreas: string[];
  verificationStatus: VerificationStatus;
  listingStatus: ListingStatus;
  availability: AvailabilityStatus;
  operatingHours: OperatingHours | null;
  /** Vehicle the driver is currently operating. */
  activeVehicleId: Uuid | null;
  /** What is still missing before the profile can be submitted for review. */
  onboarding: OnboardingChecklist;
  createdAt: IsoDateTime;
}

export interface OnboardingChecklist {
  profile: boolean;
  vehicle: boolean;
  personDocuments: boolean;
  vehicleDocuments: boolean;
  /** True once every item above is true. */
  readyForReview: boolean;
}

export interface UpsertDriverProfileRequest {
  partnerType: PartnerType;
  displayName: string;
  bio?: string | null;
  languages: string[];
  yearsExperience?: number | null;
  /** Region slugs. At least one. */
  serviceAreas: string[];
  operatingHours?: OperatingHours | null;
  /**
   * Key returned by the upload endpoint (purpose "profile_photo"). Omit to keep
   * the current photo, send null to remove it.
   */
  photoKey?: string | null;
}

export interface Vehicle {
  id: Uuid;
  /** The partner the vehicle is registered to. */
  ownerProfileId: Uuid;
  categoryCode: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  /** Full registration number, e.g. "KA47A4821". Visible to its owner and admins. */
  registrationNumber: string;
  seats: number;
  luggageCapacity: number;
  hasAc: boolean;
  photoUrls: string[];
  rates: IndicativeRates | null;
  verificationStatus: VerificationStatus;
  listingStatus: ListingStatus;
  createdAt: IsoDateTime;
}

export interface UpsertVehicleRequest {
  categoryCode: string;
  make: string;
  model: string;
  year?: number | null;
  color?: string | null;
  registrationNumber: string;
  seats: number;
  luggageCapacity: number;
  hasAc: boolean;
  /** Keys returned by the upload endpoint. */
  photoKeys?: string[];
}

/** Indian vehicle registration: state code, RTO code, series, number. Spaces/hyphens stripped first. */
export const INDIAN_VEHICLE_REGISTRATION = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

export interface UpdateRatesRequest {
  vehicleId: Uuid;
  /** Rupee amounts in minor units. Must sit inside the category's min/max. */
  baseFareMinor: number;
  perKmMinor: number;
  perHourWaitingMinor: number;
  fullDayMinor?: number | null;
}

export interface DriverDocument {
  id: Uuid;
  type: DocumentType;
  /** Set for vehicle documents. */
  vehicleId: Uuid | null;
  /** Last four characters only; the full number is admin-visible. */
  numberMasked: string | null;
  expiresOn: IsoDate | null;
  status: DocumentStatus;
  rejectionReason: DocumentRejectionReason | null;
  reviewerNote: string | null;
  submittedAt: IsoDateTime;
  reviewedAt: IsoDateTime | null;
}

export interface SubmitDocumentRequest {
  type: DocumentType;
  vehicleId?: Uuid;
  documentNumber?: string;
  expiresOn?: IsoDate;
  /** Key returned by the upload endpoint. */
  fileKey: string;
}

export interface UpdateAvailabilityRequest {
  status: AvailabilityStatus;
  /** Vehicle being operated. Required when going available. */
  vehicleId?: Uuid;
}

export interface LocationPing {
  location: LatLng;
  accuracyMeters?: number;
  /** When the device took the fix. Pings older than 5 minutes are rejected. */
  recordedAt: IsoDateTime;
}

// --- Owner <-> driver authorisation -----------------------------------------

export const AuthorizationStatus = {
  /** Owner invited the driver; driver has not accepted. */
  Invited: 'invited',
  Active: 'active',
  Revoked: 'revoked',
  Expired: 'expired',
} as const;
export type AuthorizationStatus = (typeof AuthorizationStatus)[keyof typeof AuthorizationStatus];

/**
 * The record that lets someone other than the registered owner operate a
 * vehicle on the platform. A driver may go available with a vehicle only if
 * they own it or hold an Active authorisation for it.
 */
export interface VehicleAuthorization {
  id: Uuid;
  vehicleId: Uuid;
  vehicleLabel: string;
  ownerProfileId: Uuid;
  ownerName: string;
  driverProfileId: Uuid | null;
  /** Masked phone of the invited driver. */
  driverPhoneMasked: string;
  driverName: string | null;
  status: AuthorizationStatus;
  validUntil: IsoDate | null;
  createdAt: IsoDateTime;
}

export interface CreateAuthorizationRequest {
  vehicleId: Uuid;
  /** E.164 phone of the driver being authorised. */
  driverPhone: string;
  validUntil?: IsoDate;
}

// --- Uploads ------------------------------------------------------------------

export const UploadPurpose = {
  DriverDocument: 'driver_document',
  VehiclePhoto: 'vehicle_photo',
  ProfilePhoto: 'profile_photo',
} as const;
export type UploadPurpose = (typeof UploadPurpose)[keyof typeof UploadPurpose];

export const UPLOAD_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export interface PresignUploadRequest {
  purpose: UploadPurpose;
  contentType: (typeof UPLOAD_ALLOWED_CONTENT_TYPES)[number];
  sizeBytes: number;
}

export interface PresignUploadResponse {
  /** Opaque key to send back in the request that attaches the file. */
  fileKey: string;
  /** PUT the raw bytes here with the given headers. */
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: IsoDateTime;
}

// --- Performance ---------------------------------------------------------------

export interface DriverMetrics {
  /** Rolling window the figures cover. */
  periodDays: number;
  enquiriesReceived: number;
  quotesSent: number;
  bookingsWon: number;
  bookingsCompleted: number;
  /** 0-1. Null when there is not enough data. */
  cancellationRate: number | null;
  rating: RatingSummary;
  /** Sum of quoted fares on completed bookings. Paid directly by customers. */
  completedFareTotal: Money;
  profileViews: number;
}
