import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AppConfigService } from '../config/app-config.service';
import { toApiError } from '../api/api-error';
import { AuthStore } from './auth.store';

/**
 * For requests to our own API only:
 *  - attaches the in-memory access token;
 *  - on a 401, refreshes once (shared across concurrent requests) and retries;
 *  - converts every failure into an ApiError.
 *
 * Requests to any other origin (for example a presigned S3 upload) pass
 * through untouched - they must never receive our Authorization header.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(AppConfigService);
  const auth = inject(AuthStore);

  if (!isApiRequest(req.url, config.apiBaseUrl)) {
    return next(req);
  }

  const send = (token: string | null) => next(withAuth(req, token));

  return send(auth.token()).pipe(
    catchError((error: unknown) => {
      const expired = error instanceof HttpErrorResponse && error.status === 401;
      if (!expired || !auth.mayHaveSession()) {
        return throwError(() => error);
      }
      return auth.refreshToken().pipe(
        switchMap((token) => (token ? send(token) : throwError(() => error))),
      );
    }),
    catchError((error: unknown) => throwError(() => toApiError(error))),
  );
};

function withAuth(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return req.clone({
    withCredentials: true,
    setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function isApiRequest(url: string, apiBaseUrl: string): boolean {
  return url.startsWith(apiBaseUrl + '/') || url === apiBaseUrl;
}
