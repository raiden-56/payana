/** ISO-8601 timestamp in UTC, e.g. "2026-11-10T09:30:00.000Z". */
export type IsoDateTime = string;
/** Calendar date, e.g. "2027-03-31". */
export type IsoDate = string;
export type Uuid = string;

export interface LatLng {
  lat: number;
  lng: number;
}

/** A named point chosen by a user (pickup, drop, saved place). */
export interface Place {
  label: string;
  address?: string;
  location: LatLng;
  /** Region the point falls in, when the server could resolve one. */
  regionSlug?: string;
}

export const Currency = { INR: 'INR' } as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

/**
 * Money is always an integer number of minor units (paise for INR).
 * 45000 = Rs 450.00. Never use floating-point rupees on the wire.
 */
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export interface PageQuery {
  /** 1-based. Default 1. */
  page?: number;
  /** Default 20, maximum 50. */
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/**
 * Stable, machine-readable error codes. Clients branch on `code`,
 * never on `title` or `detail` text.
 */
export const ErrorCode = {
  ValidationFailed: 'validation_failed',
  Unauthenticated: 'unauthenticated',
  TokenExpired: 'token_expired',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'conflict',
  RateLimited: 'rate_limited',
  IdempotencyKeyReused: 'idempotency_key_reused',
  IdempotencyKeyRequired: 'idempotency_key_required',
  // identity
  OtpInvalid: 'otp_invalid',
  OtpExpired: 'otp_expired',
  OtpAttemptsExceeded: 'otp_attempts_exceeded',
  AccountLocked: 'account_locked',
  AccountSuspended: 'account_suspended',
  MfaRequired: 'mfa_required',
  MfaInvalid: 'mfa_invalid',
  InvalidCredentials: 'invalid_credentials',
  // marketplace
  DriverNotVerified: 'driver_not_verified',
  VehicleNotAuthorized: 'vehicle_not_authorized',
  DocumentExpired: 'document_expired',
  OutsideServiceArea: 'outside_service_area',
  EntitlementExceeded: 'entitlement_exceeded',
  // bookings
  RequestNotOpen: 'request_not_open',
  QuoteNotActive: 'quote_not_active',
  InvalidTransition: 'invalid_transition',
  CancellationNotAllowed: 'cancellation_not_allowed',
  ReviewNotEligible: 'review_not_eligible',
  // platform
  FeatureDisabled: 'feature_disabled',
  UpstreamUnavailable: 'upstream_unavailable',
  Internal: 'internal_error',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface FieldError {
  /** Dot path of the offending field, e.g. "pickup.location.lat". */
  field: string;
  message: string;
}

/**
 * Every non-2xx response body. Shape follows RFC 9457 (problem details)
 * with `code`, `errors` and `traceId` extensions.
 * Served as `application/problem+json`.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: FieldError[];
  /** Correlates with the `x-request-id` response header and server logs. */
  traceId?: string;
  /** Present on 429 and on lockouts. */
  retryAfterSeconds?: number;
}

/** Header carrying the client-generated key for idempotent POSTs. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const REQUEST_ID_HEADER = 'x-request-id';

/** Indian mobile number in E.164 form: +91 followed by 10 digits starting 6-9. */
export const INDIAN_MOBILE_E164 = /^\+91[6-9]\d{9}$/;
