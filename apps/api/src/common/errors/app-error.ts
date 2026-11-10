import { ErrorCode, type FieldError } from '@payana/contracts';

/**
 * The one exception type application code throws. The global filter turns it
 * into an RFC 9457 problem document; nothing else in the codebase decides
 * HTTP status codes for failures.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly detail?: string,
    readonly extra: { errors?: FieldError[]; retryAfterSeconds?: number } = {},
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }

  static validation(errors: FieldError[], detail = 'One or more fields are invalid.'): AppError {
    return new AppError(400, ErrorCode.ValidationFailed, 'Validation failed', detail, { errors });
  }
  static invalid(field: string, message: string): AppError {
    return AppError.validation([{ field, message }], message);
  }
  static unauthenticated(detail = 'Sign in to continue.'): AppError {
    return new AppError(401, ErrorCode.Unauthenticated, 'Authentication required', detail);
  }
  static tokenExpired(detail = 'The session has expired. Sign in again.'): AppError {
    return new AppError(401, ErrorCode.TokenExpired, 'Session expired', detail);
  }
  static forbidden(detail = 'You are not allowed to do this.', code: ErrorCode = ErrorCode.Forbidden): AppError {
    return new AppError(403, code, 'Forbidden', detail);
  }
  static notFound(what = 'Resource'): AppError {
    return new AppError(404, ErrorCode.NotFound, 'Not found', `${what} was not found.`);
  }
  static conflict(detail: string, code: ErrorCode = ErrorCode.Conflict): AppError {
    return new AppError(409, code, 'Conflict', detail);
  }
  static rateLimited(retryAfterSeconds: number, detail = 'Too many requests. Try again shortly.'): AppError {
    return new AppError(429, ErrorCode.RateLimited, 'Too many requests', detail, { retryAfterSeconds });
  }
  static unprocessable(code: ErrorCode, detail: string): AppError {
    return new AppError(422, code, 'Request cannot be processed', detail);
  }
}
