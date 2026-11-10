import type { IsoDateTime, Money, PageQuery, Place, Uuid } from './common.js';
import type { FareEstimate } from './catalog.js';
import type { RatingSummary, VehicleSummary } from './marketplace.js';

// ---------------------------------------------------------------------------
// Ride requests (the customer's ask)
// ---------------------------------------------------------------------------

export const TripType = {
  /** Pick me up now. */
  Immediate: 'immediate',
  /** A local trip at a future date and time. */
  Scheduled: 'scheduled',
  /** City-to-city, one way or return. */
  Outstation: 'outstation',
  /** A sightseeing package or custom day tour. */
  Sightseeing: 'sightseeing',
} as const;
export type TripType = (typeof TripType)[keyof typeof TripType];

export const RideRequestStatus = {
  /** Visible to matching drivers; quotes may arrive. */
  Open: 'open',
  /** The customer accepted a quote; a booking exists. */
  Booked: 'booked',
  /** Nobody was chosen before `expiresAt`. */
  Expired: 'expired',
  Cancelled: 'cancelled',
} as const;
export type RideRequestStatus = (typeof RideRequestStatus)[keyof typeof RideRequestStatus];

/** How long a request stays open for quotes, by trip type. */
export const REQUEST_TTL_MINUTES: Readonly<Record<TripType, number>> = {
  [TripType.Immediate]: 10,
  [TripType.Scheduled]: 12 * 60,
  [TripType.Outstation]: 24 * 60,
  [TripType.Sightseeing]: 24 * 60,
};

/** Scheduled / outstation / sightseeing trips must start at least this far ahead. */
export const MIN_ADVANCE_NOTICE_MINUTES = 30;
/** ...and at most this far ahead. */
export const MAX_ADVANCE_DAYS = 90;
export const MAX_PASSENGERS = 20;
export const MAX_OPEN_REQUESTS_PER_CUSTOMER = 3;

/** Send with an `Idempotency-Key` header. */
export interface CreateRideRequest {
  tripType: TripType;
  pickup: Place;
  /** Required except for sightseeing requests tied to a package. */
  drop?: Place;
  /** Required for every trip type except "immediate". */
  scheduledAt?: IsoDateTime;
  /** Outstation return trips. */
  returnAt?: IsoDateTime;
  categoryCode: string;
  passengers: number;
  luggage?: number;
  notes?: string;
  /** Sightseeing package being requested. */
  packageId?: Uuid;
  /** Ask one specific driver (from their profile) instead of everyone nearby. */
  targetDriverId?: Uuid;
}

export interface RideRequest {
  id: Uuid;
  status: RideRequestStatus;
  tripType: TripType;
  pickup: Place;
  drop: Place | null;
  scheduledAt: IsoDateTime | null;
  returnAt: IsoDateTime | null;
  categoryCode: string;
  categoryName: string;
  passengers: number;
  luggage: number;
  notes: string | null;
  packageId: Uuid | null;
  packageTitle: string | null;
  targetDriverId: Uuid | null;
  estimate: FareEstimate | null;
  /** Drivers the request was offered to. */
  driversNotified: number;
  quotes: Quote[];
  /** Set once status is "booked". */
  bookingId: Uuid | null;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export interface RideRequestListQuery extends PageQuery {
  status?: RideRequestStatus;
}

// ---------------------------------------------------------------------------
// Quotations (the driver's answer)
// ---------------------------------------------------------------------------

export const QuoteStatus = {
  Active: 'active',
  Accepted: 'accepted',
  /** Another quote was accepted, or the request closed. */
  Closed: 'closed',
  Withdrawn: 'withdrawn',
  Expired: 'expired',
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

/** What a customer sees about the driver behind a quote. */
export interface QuoteDriver {
  driverId: Uuid;
  displayName: string;
  photoUrl: string | null;
  isVerified: boolean;
  rating: RatingSummary;
  completedTrips: number;
  languages: string[];
}

export interface Quote {
  id: Uuid;
  requestId: Uuid;
  status: QuoteStatus;
  driver: QuoteDriver;
  vehicle: VehicleSummary;
  /** The price for the trip as described. Paid to the driver. */
  fare: Money;
  inclusions: string[];
  exclusions: string[];
  /** e.g. "I'll wait at the Main Beach parking gate". */
  pickupNote: string | null;
  /** Minutes to reach the pickup, for immediate trips. */
  etaMinutes: number | null;
  validUntil: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface SubmitQuoteRequest {
  vehicleId: Uuid;
  fareMinor: number;
  inclusions?: string[];
  exclusions?: string[];
  pickupNote?: string;
  etaMinutes?: number;
  /** Minutes the quote stays valid. 5 - 1440; capped at the request's expiry. */
  validForMinutes: number;
}

export const QUOTE_INCLUSION_SUGGESTIONS = [
  'Fuel',
  'Driver allowance',
  'Tolls',
  'Parking',
  'Waiting up to 30 min',
  'AC',
] as const;

export const MAX_QUOTE_LINE_ITEMS = 8;

/** A request as it appears in a driver's inbox. No customer phone or surname. */
export interface DriverRequestFeedItem {
  requestId: Uuid;
  tripType: TripType;
  pickup: Place;
  drop: Place | null;
  scheduledAt: IsoDateTime | null;
  returnAt: IsoDateTime | null;
  categoryCode: string;
  passengers: number;
  luggage: number;
  notes: string | null;
  packageTitle: string | null;
  customerFirstName: string | null;
  /** From the driver's last fresh position to the pickup. Null if unknown. */
  distanceToPickupKm: number | null;
  estimate: FareEstimate | null;
  /** True when the customer asked for this driver specifically. */
  directRequest: boolean;
  /** This driver's own quote on the request, if any. */
  myQuote: Pick<Quote, 'id' | 'status' | 'fare' | 'validUntil'> | null;
  competingQuotes: number;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const BookingStatus = {
  Confirmed: 'confirmed',
  DriverEnRoute: 'driver_en_route',
  DriverArrived: 'driver_arrived',
  InProgress: 'in_progress',
  Completed: 'completed',
  CancelledByCustomer: 'cancelled_by_customer',
  CancelledByDriver: 'cancelled_by_driver',
  CancelledByAdmin: 'cancelled_by_admin',
  /** Driver arrived; the customer never showed. */
  NoShow: 'no_show',
  /** Under review by support. */
  Disputed: 'disputed',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/**
 * Transitions a DRIVER may request. The API is the authority; clients use
 * this only to decide which buttons to offer.
 */
export const DRIVER_BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  [BookingStatus.Confirmed]: [BookingStatus.DriverEnRoute],
  [BookingStatus.DriverEnRoute]: [BookingStatus.DriverArrived],
  [BookingStatus.DriverArrived]: [BookingStatus.InProgress, BookingStatus.NoShow],
  [BookingStatus.InProgress]: [BookingStatus.Completed],
  [BookingStatus.Completed]: [],
  [BookingStatus.CancelledByCustomer]: [],
  [BookingStatus.CancelledByDriver]: [],
  [BookingStatus.CancelledByAdmin]: [],
  [BookingStatus.NoShow]: [],
  [BookingStatus.Disputed]: [],
};

/** Statuses from which a customer or driver may still cancel. */
export const CANCELLABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.Confirmed,
  BookingStatus.DriverEnRoute,
  BookingStatus.DriverArrived,
];

export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.Confirmed,
  BookingStatus.DriverEnRoute,
  BookingStatus.DriverArrived,
  BookingStatus.InProgress,
];

export const CancellationReason = {
  ChangeOfPlans: 'change_of_plans',
  FoundAnotherRide: 'found_another_ride',
  DriverDelayed: 'driver_delayed',
  DriverAskedToCancel: 'driver_asked_to_cancel',
  PriceDispute: 'price_dispute',
  VehicleIssue: 'vehicle_issue',
  CustomerUnreachable: 'customer_unreachable',
  SafetyConcern: 'safety_concern',
  Other: 'other',
} as const;
export type CancellationReason = (typeof CancellationReason)[keyof typeof CancellationReason];

export interface CancelBookingRequest {
  reason: CancellationReason;
  note?: string;
}

export interface TransitionBookingRequest {
  to: BookingStatus;
}

/**
 * The policy that applied when the booking was made, frozen onto the booking
 * so later configuration changes do not rewrite history.
 */
export interface CancellationPolicy {
  /** Cancel at least this long before pickup and nothing is charged. */
  freeUntilMinutesBefore: number;
  /** Charged when cancelling later than that. Zero when no fee applies. */
  lateFee: Money;
  /** Plain-language summary shown to the customer. */
  summary: string;
}

export interface BookingFare {
  /** Agreed with the driver; paid to the driver directly. */
  quoted: Money;
  /** Platform booking fee. Zero when the fee is switched off. */
  bookingFee: Money;
  total: Money;
}

export interface BookingParty {
  id: Uuid;
  displayName: string;
  photoUrl: string | null;
  /**
   * Phone number for calling. Present only while the booking is active and
   * only to the other party of this booking.
   */
  phone: string | null;
  rating?: RatingSummary;
}

export interface BookingEvent {
  status: BookingStatus;
  at: IsoDateTime;
  actor: 'customer' | 'driver' | 'admin' | 'system';
  note: string | null;
}

export interface Booking {
  id: Uuid;
  /** Short human reference, e.g. "PY-7K3Q9". */
  code: string;
  status: BookingStatus;
  tripType: TripType;
  pickup: Place;
  drop: Place | null;
  /** Pickup time. For immediate trips, when the booking was confirmed. */
  scheduledAt: IsoDateTime;
  returnAt: IsoDateTime | null;
  passengers: number;
  luggage: number;
  notes: string | null;
  packageTitle: string | null;
  fare: BookingFare;
  inclusions: string[];
  exclusions: string[];
  pickupNote: string | null;
  customer: BookingParty;
  driver: BookingParty;
  vehicle: VehicleSummary & {
    /** Full plate, shown inside the booking so the customer can find the vehicle. */
    registrationNumber: string;
  };
  cancellationPolicy: CancellationPolicy;
  cancellation: {
    reason: CancellationReason;
    note: string | null;
    feeCharged: Money;
  } | null;
  timeline: BookingEvent[];
  /** What the signed-in party may do next. Computed by the server. */
  allowedActions: BookingAction[];
  /** The signed-in customer's review, once submitted. */
  reviewSubmitted: boolean;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
}

export const BookingAction = {
  Cancel: 'cancel',
  StartTrip: 'start_trip',
  MarkEnRoute: 'mark_en_route',
  MarkArrived: 'mark_arrived',
  MarkNoShow: 'mark_no_show',
  Complete: 'complete',
  Review: 'review',
  ReportIssue: 'report_issue',
  ViewReceipt: 'view_receipt',
} as const;
export type BookingAction = (typeof BookingAction)[keyof typeof BookingAction];

export interface BookingListQuery extends PageQuery {
  /** "active" = upcoming and in progress; "past" = completed and cancelled. */
  scope?: 'active' | 'past' | 'all';
}

export interface Receipt {
  bookingCode: string;
  issuedAt: IsoDateTime;
  customerName: string;
  driverName: string;
  vehicleLabel: string;
  registrationNumber: string;
  tripType: TripType;
  pickupLabel: string;
  dropLabel: string | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  fare: BookingFare;
  /** e.g. "Paid directly to the driver". */
  paymentNote: string;
}
