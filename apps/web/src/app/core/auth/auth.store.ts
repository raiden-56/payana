import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, of, shareReplay, tap, timeout } from 'rxjs';
import {
  AccountRole,
  ApiRoutes,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type AdminMfaVerifyRequest,
  type AuthSession,
  type Me,
  type OtpChallenge,
  type OtpRequest,
  type OtpVerifyRequest,
  type Permission,
} from '@payana/contracts';
import { AppConfigService } from '../config/app-config.service';
import { KEY_VALUE_STORAGE } from '../platform/platform';
import { toApiError } from '../api/api-error';

/** Set while this device believes it has a refresh cookie. Holds no secret. */
const SESSION_HINT_KEY = 'payana.session';

/**
 * Who is signed in.
 *
 * Token handling, deliberately:
 *  - The access token lives only in this object's memory. It is never written
 *    to localStorage, so a script injected into the page cannot lift a
 *    long-lived credential from storage.
 *  - The refresh token is an HttpOnly cookie the browser sends to the auth
 *    endpoints; JavaScript never sees it.
 *  - After a reload the app calls /auth/refresh once to get a new access token.
 *
 * Everything here is convenience for the UI. The API re-checks role,
 * permission and ownership on every request.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly config = inject(AppConfigService);
  private readonly storage = inject(KEY_VALUE_STORAGE);
  // A client with no interceptors: auth calls must not trigger the
  // refresh-on-401 logic that they themselves implement.
  private readonly http = new HttpClient(inject(HttpBackend));

  private readonly meState = signal<Me | null>(null);
  private accessToken: string | null = null;
  private refreshInFlight: Observable<string | null> | null = null;

  readonly me = this.meState.asReadonly();
  readonly isAuthenticated = computed(() => this.meState() !== null);
  readonly roles = computed(() => this.meState()?.roles ?? []);
  readonly isCustomer = computed(() => this.roles().includes(AccountRole.Customer));
  readonly isDriver = computed(() => this.roles().includes(AccountRole.Driver));
  readonly isAdmin = computed(() => this.roles().includes(AccountRole.Admin));
  readonly permissions = computed(() => new Set<Permission>(this.meState()?.admin?.permissions ?? []));
  readonly displayName = computed(() => {
    const me = this.meState();
    return me?.displayName?.trim() || me?.email || maskPhone(me?.phone ?? null) || 'Account';
  });

  /** Current access token, for the HTTP interceptor. */
  token(): string | null {
    return this.accessToken;
  }

  hasPermission(permission: Permission): boolean {
    return this.permissions().has(permission);
  }

  /** Whether a silent refresh is worth attempting. */
  mayHaveSession(): boolean {
    return this.storage.get(SESSION_HINT_KEY) === '1';
  }

  /** Runs once before the app renders: restores the session if there is one. Never throws. */
  async bootstrap(): Promise<void> {
    if (!this.mayHaveSession()) return;
    await firstValueFrom(this.refreshToken().pipe(timeout({ first: 5000, with: () => of(null) })));
  }

  // --- phone OTP ------------------------------------------------------------

  requestOtp(body: OtpRequest): Observable<OtpChallenge> {
    return this.http
      .post<OtpChallenge>(this.url(ApiRoutes.auth.otpRequest), body)
      .pipe(catchError(rethrowAsApiError));
  }

  verifyOtp(body: OtpVerifyRequest): Observable<Me> {
    return this.http
      .post<AuthSession>(this.url(ApiRoutes.auth.otpVerify), body, { withCredentials: true })
      .pipe(
        map((session) => this.accept(session)),
        catchError(rethrowAsApiError),
      );
  }

  // --- administrator sign-in ---------------------------------------------------

  adminLogin(body: AdminLoginRequest): Observable<AdminLoginResponse> {
    return this.http
      .post<AdminLoginResponse>(this.url(ApiRoutes.auth.adminLogin), body, { withCredentials: true })
      .pipe(
        tap((response) => {
          if (response.status === 'authenticated') this.accept(response.session);
        }),
        catchError(rethrowAsApiError),
      );
  }

  adminMfaVerify(body: AdminMfaVerifyRequest): Observable<Me> {
    return this.http
      .post<AuthSession>(this.url(ApiRoutes.auth.adminMfaVerify), body, { withCredentials: true })
      .pipe(
        map((session) => this.accept(session)),
        catchError(rethrowAsApiError),
      );
  }

  // --- session lifecycle ----------------------------------------------------------

  /**
   * Exchanges the refresh cookie for a new access token. Concurrent callers
   * share one request. Resolves to null (and signs the user out locally) when
   * the session can no longer be refreshed.
   */
  refreshToken(): Observable<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.http
      .post<AuthSession>(this.url(ApiRoutes.auth.refresh), {}, { withCredentials: true })
      .pipe(
        map((session) => {
          this.accept(session);
          return session.accessToken;
        }),
        catchError((error) => {
          // Only a definite "no" from the server ends the session. A network
          // blip keeps the hint so the next attempt can still succeed.
          const status = toApiError(error).status;
          if (status === 401 || status === 403) this.clear();
          return of(null);
        }),
        finalize(() => (this.refreshInFlight = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight;
  }

  /** Re-reads the account (after onboarding, a profile edit, a role change). */
  reloadMe(): Observable<Me | null> {
    if (!this.accessToken) return of(null);
    return this.http
      .get<Me>(this.url(ApiRoutes.me.root), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      .pipe(
        tap((me) => this.meState.set(me)),
        catchError(() => of(this.meState())),
      );
  }

  setMe(me: Me): void {
    this.meState.set(me);
  }

  logout(): Observable<void> {
    const token = this.accessToken;
    this.clear();
    return this.http
      .post<void>(
        this.url(ApiRoutes.auth.logout),
        {},
        { withCredentials: true, headers: token ? { Authorization: `Bearer ${token}` } : {} },
      )
      .pipe(catchError(() => of(undefined)));
  }

  /** Forget the session on this device without calling the server. */
  clear(): void {
    this.accessToken = null;
    this.meState.set(null);
    this.storage.remove(SESSION_HINT_KEY);
  }

  private accept(session: AuthSession): Me {
    this.accessToken = session.accessToken;
    this.meState.set(session.me);
    this.storage.set(SESSION_HINT_KEY, '1');
    return session.me;
  }

  private url(path: string): string {
    return this.config.apiBaseUrl + path;
  }
}

function rethrowAsApiError(error: unknown): never {
  throw toApiError(error);
}

/** "+91 98••• ••321" - enough to recognise your own number, not enough to read it off a screen. */
export function maskPhone(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const local = digits.slice(-10);
  if (local.length < 10) return phone;
  return `+91 ${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}
