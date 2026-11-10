import {
  type AuthorizationStatus,
  type AvailabilityStatus,
  type DocumentRejectionReason,
  type DocumentStatus,
  type DocumentType,
  type DriverDocument,
  type IndicativeRates,
  type ListingStatus,
  type OperatingHours,
  type PartnerType,
  type RatingSummary,
  type Vehicle,
  type VehicleSummary,
  type VerificationStatus,
} from '@payana/contracts';
import { maskRegistration } from '../../../common/crypto.js';
import { dateOnly, inr, inrOrNull, isoReq, iso, numOrNull } from '../../../common/money.js';
import type { CategoryRow } from '../../catalog/application/catalog.service.js';
import type { DocumentFacts } from '../domain/marketplace-rules.js';

export interface DriverProfileRow {
  id: string;
  user_id: string;
  partner_type: PartnerType;
  display_name: string;
  bio: string | null;
  photo_key: string | null;
  languages: string[];
  years_experience: number | null;
  service_areas: string[];
  verification_status: VerificationStatus;
  listing_status: ListingStatus;
  availability: AvailabilityStatus;
  operating_hours: OperatingHours | null;
  active_vehicle_id: string | null;
  last_lat: number | null;
  last_lng: number | null;
  location_updated_at: Date | null;
  rating_average: string | null;
  rating_count: number;
  completed_trips: number;
  accepted_bookings: number;
  cancelled_bookings: number;
  profile_views: number;
  submitted_at: Date | null;
  created_at: Date;
}

export interface VehicleRow {
  id: string;
  owner_profile_id: string;
  category_code: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  registration_number: string;
  seats: number;
  luggage_capacity: number;
  has_ac: boolean;
  photo_keys: string[];
  base_fare_minor: number | null;
  per_km_minor: number | null;
  per_hour_waiting_minor: number | null;
  full_day_minor: number | null;
  verification_status: VerificationStatus;
  listing_status: ListingStatus;
  deleted_at: Date | null;
  created_at: Date;
}

export interface DocumentRow {
  id: string;
  driver_profile_id: string;
  vehicle_id: string | null;
  type: DocumentType;
  document_number_enc: string | null;
  document_number_tail: string | null;
  expires_on: Date | string | null;
  file_key: string;
  content_type: string;
  status: DocumentStatus;
  rejection_reason: DocumentRejectionReason | null;
  reviewer_note: string | null;
  is_current: boolean;
  expiry_notice_days: number | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  reviewed_by_label: string | null;
}

export interface AuthorizationRow {
  id: string;
  vehicle_id: string;
  owner_profile_id: string;
  driver_profile_id: string | null;
  driver_phone: string;
  status: AuthorizationStatus;
  valid_until: Date | string | null;
  created_at: Date;
}

export const ratingOf = (p: Pick<DriverProfileRow, 'rating_average' | 'rating_count'>): RatingSummary => ({
  average: numOrNull(p.rating_average),
  count: p.rating_count,
});

/** Share of accepted bookings the driver cancelled; null until there are five to judge by. */
export function cancellationRate(p: Pick<DriverProfileRow, 'accepted_bookings' | 'cancelled_bookings'>): number | null {
  if (p.accepted_bookings < 5) return null;
  return Math.round((p.cancelled_bookings / p.accepted_bookings) * 100) / 100;
}

/** The driver's own rates where set, otherwise the category's standard rates. */
export function ratesOf(v: VehicleRow, category: CategoryRow | undefined): IndicativeRates {
  return {
    baseFare: inr(v.base_fare_minor ?? category?.base_fare_minor ?? 0),
    perKm: inr(v.per_km_minor ?? category?.per_km_minor ?? 0),
    perHourWaiting: inr(v.per_hour_waiting_minor ?? category?.per_hour_waiting_minor ?? 0),
    fullDay: inrOrNull(v.full_day_minor),
  };
}

export function toVehicleSummary(v: VehicleRow, category: CategoryRow | undefined, photoUrl: string | null): VehicleSummary {
  return {
    id: v.id,
    categoryCode: v.category_code,
    categoryName: category?.name ?? v.category_code,
    icon: category?.icon ?? 'sedan',
    make: v.make,
    model: v.model,
    color: v.color,
    seats: v.seats,
    luggageCapacity: v.luggage_capacity,
    hasAc: v.has_ac,
    registrationMasked: maskRegistration(v.registration_number),
    photoUrl,
  };
}

export function toVehicle(v: VehicleRow, photoUrls: string[]): Vehicle {
  const hasRates = v.base_fare_minor !== null && v.per_km_minor !== null && v.per_hour_waiting_minor !== null;
  return {
    id: v.id,
    ownerProfileId: v.owner_profile_id,
    categoryCode: v.category_code,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    registrationNumber: v.registration_number,
    seats: v.seats,
    luggageCapacity: v.luggage_capacity,
    hasAc: v.has_ac,
    photoUrls,
    rates: hasRates
      ? {
          baseFare: inr(v.base_fare_minor!),
          perKm: inr(v.per_km_minor!),
          perHourWaiting: inr(v.per_hour_waiting_minor!),
          fullDay: inrOrNull(v.full_day_minor),
        }
      : null,
    verificationStatus: v.verification_status,
    listingStatus: v.listing_status,
    createdAt: isoReq(v.created_at),
  };
}

export function toDriverDocument(d: DocumentRow): DriverDocument {
  return {
    id: d.id,
    type: d.type,
    vehicleId: d.vehicle_id,
    numberMasked: d.document_number_tail ? `••••${d.document_number_tail}` : null,
    expiresOn: dateOnly(d.expires_on),
    status: d.status,
    rejectionReason: d.rejection_reason,
    reviewerNote: d.reviewer_note,
    submittedAt: isoReq(d.submitted_at),
    reviewedAt: iso(d.reviewed_at),
  };
}

export const toFacts = (d: DocumentRow): DocumentFacts => ({
  type: d.type,
  vehicleId: d.vehicle_id,
  status: d.status,
  expiresOn: dateOnly(d.expires_on),
});

/** Today's date in India ("YYYY-MM-DD"): document expiry is a calendar-date rule in IST. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}
