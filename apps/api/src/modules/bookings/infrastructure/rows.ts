import type {
  BookingStatus,
  CancellationPolicy,
  CancellationReason,
  FareEstimate,
  Place,
  QuoteStatus,
  RideRequestStatus,
  TripType,
} from '@payana/contracts';

export interface RideRequestRow {
  id: string;
  customer_id: string;
  status: RideRequestStatus;
  trip_type: TripType;
  pickup: Place;
  pickup_lat: number;
  pickup_lng: number;
  drop_place: Place | null;
  region_slug: string | null;
  scheduled_at: Date | null;
  return_at: Date | null;
  category_code: string;
  passengers: number;
  luggage: number;
  notes: string | null;
  package_id: string | null;
  package_title: string | null;
  target_driver_id: string | null;
  estimate: FareEstimate | null;
  drivers_notified: number;
  booking_id: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface QuoteRow {
  id: string;
  request_id: string;
  driver_profile_id: string;
  vehicle_id: string;
  status: QuoteStatus;
  fare_minor: number;
  inclusions: string[];
  exclusions: string[];
  pickup_note: string | null;
  eta_minutes: number | null;
  valid_until: Date;
  created_at: Date;
}

export interface BookingRow {
  id: string;
  code: string;
  request_id: string;
  quote_id: string;
  customer_id: string;
  driver_profile_id: string;
  vehicle_id: string;
  status: BookingStatus;
  trip_type: TripType;
  pickup: Place;
  drop_place: Place | null;
  scheduled_at: Date;
  return_at: Date | null;
  passengers: number;
  luggage: number;
  notes: string | null;
  package_title: string | null;
  quoted_minor: number;
  booking_fee_minor: number;
  total_minor: number;
  inclusions: string[];
  exclusions: string[];
  pickup_note: string | null;
  cancellation_policy: CancellationPolicy;
  cancellation: { reason: CancellationReason; note: string | null; feeChargedMinor: number } | null;
  review_submitted: boolean;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface BookingEventRow {
  status: BookingStatus;
  at: Date;
  actor: 'customer' | 'driver' | 'admin' | 'system';
  note: string | null;
}
