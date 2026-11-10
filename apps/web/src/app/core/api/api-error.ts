import { HttpErrorResponse } from '@angular/common/http';
import { ErrorCode, type FieldError, type ProblemDetails } from '@payana/contracts';

/** Client-side failure kinds that never reach the server. */
export type ClientErrorCode = 'network' | 'timeout' | 'unknown';

/**
 * The one error type features deal with. Built from the API's ProblemDetails
 * body, or from a transport failure. Features branch on `code`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | ClientErrorCode,
    message: string,
    readonly problem: ProblemDetails | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fieldErrors(): FieldError[] {
    return this.problem?.errors ?? [];
  }

  get retryAfterSeconds(): number | null {
    return this.problem?.retryAfterSeconds ?? null;
  }

  get traceId(): string | null {
    return this.problem?.traceId ?? null;
  }

  /** The request never got an answer - offline, DNS, CORS, server down. */
  get isTransport(): boolean {
    return this.code === 'network' || this.code === 'timeout';
  }

  /** Worth offering a "Try again" button for. */
  get isRetryable(): boolean {
    return this.isTransport || this.status >= 500 || this.code === ErrorCode.RateLimited;
  }

  is(code: ErrorCode | ClientErrorCode): boolean {
    return this.code === code;
  }
}

/** Plain-language messages, keyed by code. Shown to people, so no jargon. */
const MESSAGES: Partial<Record<ErrorCode | ClientErrorCode, string>> = {
  network: 'We could not reach the server. Check your connection and try again.',
  timeout: 'That took too long. Please try again.',
  unknown: 'Something went wrong. Please try again.',
  [ErrorCode.ValidationFailed]: 'Some details need fixing. Check the highlighted fields.',
  [ErrorCode.Unauthenticated]: 'Please sign in to continue.',
  [ErrorCode.TokenExpired]: 'Your session ended. Please sign in again.',
  [ErrorCode.Forbidden]: 'You do not have permission to do that.',
  [ErrorCode.NotFound]: 'We could not find that. It may have been removed.',
  [ErrorCode.Conflict]: 'That changed while you were looking at it. Refresh and try again.',
  [ErrorCode.RateLimited]: 'Too many attempts. Please wait a moment and try again.',
  [ErrorCode.IdempotencyKeyReused]: 'That request was already sent. Refresh to see the result.',
  [ErrorCode.OtpInvalid]: 'That code is not right. Check the SMS and try again.',
  [ErrorCode.OtpExpired]: 'That code has expired. Request a new one.',
  [ErrorCode.OtpAttemptsExceeded]: 'Too many wrong codes. Request a new one.',
  [ErrorCode.AccountLocked]: 'This account is temporarily locked after too many attempts.',
  [ErrorCode.AccountSuspended]: 'This account is suspended. Contact support for help.',
  [ErrorCode.MfaInvalid]: 'That authenticator code is not right.',
  [ErrorCode.InvalidCredentials]: 'The e-mail or password is not right.',
  [ErrorCode.DriverNotVerified]: 'Your profile has to be verified before you can do this.',
  [ErrorCode.VehicleNotAuthorized]: 'You are not authorised to operate that vehicle.',
  [ErrorCode.DocumentExpired]: 'A required document has expired. Upload a current one to continue.',
  [ErrorCode.OutsideServiceArea]: 'That location is outside the areas we serve right now.',
  [ErrorCode.EntitlementExceeded]: 'You have reached the limit of your current plan.',
  [ErrorCode.RequestNotOpen]: 'This request is no longer open.',
  [ErrorCode.QuoteNotActive]: 'This quote is no longer available.',
  [ErrorCode.InvalidTransition]: 'That step is not possible from the current booking status.',
  [ErrorCode.CancellationNotAllowed]: 'This booking can no longer be cancelled here. Contact support.',
  [ErrorCode.ReviewNotEligible]: 'This booking cannot be reviewed.',
  [ErrorCode.FeatureDisabled]: 'This feature is not available right now.',
  [ErrorCode.UpstreamUnavailable]: 'A service we depend on is not responding. Please try again shortly.',
  [ErrorCode.Internal]: 'Something went wrong on our side. Please try again.',
};

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode));

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return new ApiError(0, 'network', MESSAGES.network!);
    }
    const problem = asProblem(error.error);
    const code: ErrorCode | ClientErrorCode =
      problem && KNOWN_CODES.has(problem.code) ? problem.code : fallbackCode(error.status);
    return new ApiError(error.status, code, MESSAGES[code] ?? MESSAGES.unknown!, problem);
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return new ApiError(0, 'timeout', MESSAGES.timeout!);
  }

  return new ApiError(0, 'unknown', MESSAGES.unknown!);
}

/** The sentence to show a person for any thrown value. */
export function errorMessage(error: unknown): string {
  return toApiError(error).message;
}

function asProblem(body: unknown): ProblemDetails | null {
  if (body && typeof body === 'object' && 'code' in body && 'status' in body) {
    return body as ProblemDetails;
  }
  return null;
}

function fallbackCode(status: number): ErrorCode | ClientErrorCode {
  switch (status) {
    case 400:
    case 422:
      return ErrorCode.ValidationFailed;
    case 401:
      return ErrorCode.Unauthenticated;
    case 403:
      return ErrorCode.Forbidden;
    case 404:
      return ErrorCode.NotFound;
    case 409:
      return ErrorCode.Conflict;
    case 429:
      return ErrorCode.RateLimited;
    default:
      return status >= 500 ? ErrorCode.Internal : 'unknown';
  }
}
