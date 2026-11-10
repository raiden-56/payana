import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { IDEMPOTENCY_KEY_HEADER } from '@payana/contracts';
import { AppConfigService } from '../config/app-config.service';
import { newIdempotencyKey } from '../platform/platform';

type QueryValue = string | number | boolean | null | undefined;
type QueryObject = object;

export interface RequestOptions {
  /** Query-string parameters. Null, undefined and empty-string values are dropped. */
  query?: QueryObject;
  /**
   * Sends an Idempotency-Key header. Pass `true` for a fresh key, or a string
   * to reuse one across retries of the same user action.
   */
  idempotent?: boolean | string;
}

/**
 * Thin typed wrapper over HttpClient. It only knows how to prefix the API base
 * URL, serialise query objects and attach idempotency keys - authentication,
 * token refresh and error mapping live in the HTTP interceptor.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfigService);

  get<T>(path: string, options: RequestOptions = {}): Observable<T> {
    return this.http.get<T>(this.url(path), { params: toParams(options.query) });
  }

  post<T>(path: string, body: unknown = {}, options: RequestOptions = {}): Observable<T> {
    return this.http.post<T>(this.url(path), body, {
      params: toParams(options.query),
      headers: idempotencyHeaders(options.idempotent),
    });
  }

  put<T>(path: string, body: unknown = {}, options: RequestOptions = {}): Observable<T> {
    return this.http.put<T>(this.url(path), body, { params: toParams(options.query) });
  }

  patch<T>(path: string, body: unknown = {}, options: RequestOptions = {}): Observable<T> {
    return this.http.patch<T>(this.url(path), body, { params: toParams(options.query) });
  }

  delete<T = void>(path: string, options: RequestOptions = {}): Observable<T> {
    return this.http.delete<T>(this.url(path), { params: toParams(options.query) });
  }

  /** Absolute URL for a contract path. */
  url(path: string): string {
    return this.config.apiBaseUrl + path;
  }
}

function toParams(query: QueryObject | undefined): HttpParams | undefined {
  if (!query) return undefined;
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query) as [string, QueryValue][]) {
    if (value === null || value === undefined || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}

function idempotencyHeaders(idempotent: boolean | string | undefined): Record<string, string> | undefined {
  if (!idempotent) return undefined;
  return { [IDEMPOTENCY_KEY_HEADER]: idempotent === true ? newIdempotencyKey() : idempotent };
}
