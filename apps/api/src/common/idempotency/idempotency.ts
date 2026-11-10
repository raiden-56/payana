import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { ErrorCode, IDEMPOTENCY_KEY_HEADER } from '@payana/contracts';
import type { Response } from 'express';
import { Observable, from } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.types.js';
import { sha256Hex } from '../crypto.js';
import { Db, json } from '../db/db.service.js';
import { AppError } from '../errors/app-error.js';

export const IDEMPOTENT = 'payana:idempotent';
const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

interface KeyRow {
  request_hash: string;
  status_code: number | null;
  response: unknown;
}

/**
 * Makes a POST safe to retry. The client sends an `Idempotency-Key`; the
 * first request with that key runs and its response is stored; a repeat with
 * the same key and body gets the stored response back without running again;
 * the same key with a different body is rejected.
 *
 * The key is claimed with an INSERT before the handler runs, so two
 * simultaneous requests with one key cannot both execute.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.handle(context, next));
  }

  private async handle(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    const user = req.user;
    if (!user) throw AppError.unauthenticated();

    const key = req.get(IDEMPOTENCY_KEY_HEADER);
    if (!key) {
      throw new AppError(
        400,
        ErrorCode.IdempotencyKeyRequired,
        'Idempotency key required',
        `Send an ${IDEMPOTENCY_KEY_HEADER} header with this request.`,
      );
    }
    if (!KEY_PATTERN.test(key)) {
      throw AppError.invalid(IDEMPOTENCY_KEY_HEADER, 'Must be 8-128 characters: letters, digits, "-", "_", ":" or ".".');
    }

    const scope = `${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = sha256Hex(`${req.originalUrl.split('?')[0]}\n${JSON.stringify(req.body ?? null)}`);

    const claimed = await this.db.exec(
      `INSERT INTO idempotency_keys (scope, user_id, key, request_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [scope, user.id, key, requestHash],
    );

    if (claimed === 0) {
      const existing = await this.db.one<KeyRow>(
        `SELECT request_hash, status_code, response FROM idempotency_keys
          WHERE scope = $1 AND user_id = $2 AND key = $3`,
        [scope, user.id, key],
      );
      if (!existing) throw AppError.conflict('The request is being retried too quickly. Try again.');
      if (existing.request_hash !== requestHash) {
        throw AppError.conflict(
          'This idempotency key was already used with a different request.',
          ErrorCode.IdempotencyKeyReused,
        );
      }
      if (existing.status_code === null) {
        throw AppError.conflict('The original request with this key is still being processed.');
      }
      res.status(existing.status_code);
      res.setHeader('Idempotent-Replayed', 'true');
      return existing.response;
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.db.exec(
        `UPDATE idempotency_keys SET status_code = $4, response = $5::jsonb
          WHERE scope = $1 AND user_id = $2 AND key = $3`,
        [scope, user.id, key, res.statusCode, JSON.stringify(body ?? null)],
      );
      return body;
    } catch (err) {
      // A failed attempt releases the key so the client can correct and retry.
      await this.db
        .exec(`DELETE FROM idempotency_keys WHERE scope = $1 AND user_id = $2 AND key = $3`, [scope, user.id, key])
        .catch(() => undefined);
      throw err;
    }
  }
}

/** Requires an Idempotency-Key header on the route and replays stored responses. */
export const Idempotent = () =>
  applyDecorators(SetMetadata(IDEMPOTENT, true), UseInterceptors(IdempotencyInterceptor));

export { json };
