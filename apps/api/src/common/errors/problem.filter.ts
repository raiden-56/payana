import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErrorCode, type ProblemDetails, REQUEST_ID_HEADER } from '@payana/contracts';
import type { Request, Response } from 'express';
import { AppError } from './app-error.js';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.ValidationFailed,
  401: ErrorCode.Unauthenticated,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  409: ErrorCode.Conflict,
  413: ErrorCode.ValidationFailed,
  415: ErrorCode.ValidationFailed,
  429: ErrorCode.RateLimited,
  503: ErrorCode.UpstreamUnavailable,
};

/**
 * Converts every thrown value into `application/problem+json`. Unknown
 * errors are logged with their stack and returned as an opaque 500 so that
 * internals never leak to a client.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exception, req);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, traceId: problem.traceId, path: req.originalUrl },
        'Unhandled error',
      );
    }
    if (res.headersSent) return;
    if (problem.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(problem.retryAfterSeconds));
    }
    res.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
  }

  private toProblem(exception: unknown, req: Request): ProblemDetails {
    const traceId = (req as Request & { id?: string }).id ?? headerValue(req.headers[REQUEST_ID_HEADER]);
    const base = { type: 'about:blank', traceId };

    if (exception instanceof AppError) {
      return {
        ...base,
        type: `https://errors.payana.app/${exception.code}`,
        title: exception.title,
        status: exception.status,
        code: exception.code,
        detail: exception.detail,
        ...exception.extra,
      };
    }
    if (exception instanceof ThrottlerException) {
      return {
        ...base,
        type: `https://errors.payana.app/${ErrorCode.RateLimited}`,
        title: 'Too many requests',
        status: 429,
        code: ErrorCode.RateLimited,
        detail: 'Too many requests. Try again shortly.',
        retryAfterSeconds: 60,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.Internal : ErrorCode.ValidationFailed);
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      const message = Array.isArray(raw) ? raw.map(String).join('; ') : typeof raw === 'string' ? raw : exception.message;
      return {
        ...base,
        type: `https://errors.payana.app/${code}`,
        title: status >= 500 ? 'Server error' : exception.name.replace(/Exception$/, ''),
        status,
        code,
        detail: status >= 500 ? undefined : message,
      };
    }
    // Malformed JSON bodies and oversized payloads surface from body-parser as plain errors.
    const parserStatus = (exception as { status?: number; type?: string } | null)?.status;
    const parserType = (exception as { type?: string } | null)?.type;
    if (parserType === 'entity.parse.failed' || parserType === 'entity.too.large') {
      const status = parserStatus ?? 400;
      return {
        ...base,
        type: `https://errors.payana.app/${ErrorCode.ValidationFailed}`,
        title: 'Validation failed',
        status,
        code: ErrorCode.ValidationFailed,
        detail: parserType === 'entity.too.large' ? 'Request body is too large.' : 'Request body is not valid JSON.',
      };
    }
    return {
      ...base,
      type: `https://errors.payana.app/${ErrorCode.Internal}`,
      title: 'Server error',
      status: 500,
      code: ErrorCode.Internal,
      detail: 'Something went wrong on our side. Please try again.',
    };
  }
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
