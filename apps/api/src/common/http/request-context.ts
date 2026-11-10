import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Makes the request id and client address available to services (the audit
 * log in particular) without threading them through every call.
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ctx: RequestContext = {
    requestId: ((req as Request & { id?: unknown }).id as string | undefined) ?? null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  };
  storage.run(ctx, next);
}

export function currentRequest(): RequestContext {
  return storage.getStore() ?? { requestId: null, ip: null, userAgent: null };
}
