# F-01 — Identity and access

| | |
| --- | --- |
| Requirements | FR-IAM-001 … FR-IAM-017 |
| Priority / release | P0 (FR-IAM-007 P1; FR-IAM-015, email sign-in P2) · R1 |
| Contract | `identity.ts`, `common.ts`; `ApiRoutes.auth.*` |
| API module | `apps/api/src/modules/identity` |
| Web | `core/auth`, `features/auth`, admin sign-in in `features/admin` |
| ADRs | 0003 token strategy · 0004 admin MFA · 0010 SMS port · 0013 Redis |

## 1. Business objective and scope

Let customers and drivers sign in with nothing but their phone, let
administrators sign in with a stronger method, keep sessions safe on shared
and stolen devices, and make every later authorisation decision possible on
the server.

**In scope** — phone OTP request and verification; account creation on first
sign-in; access and rotating refresh tokens; logout; session list and revoke;
OTP and login abuse controls; roles; administrator email + password + TOTP;
the permission model; suspension enforcement; security-event auditing.

**Out of scope** — profile data (F-02); staff administration screens (F-16);
email sign-in and account linking, self-service recovery (P2, see §12).

## 2. User stories and acceptance criteria

- **US-01** As a visitor I sign in with my mobile number and a code, so I do
  not need a password.
- **US-02** As a returning user I stay signed in on my device without my token
  being readable by scripts.
- **US-03** As a user I can see where I am signed in and sign a device out.
- **US-04** As the owner I want administrators to need a second factor and
  only the permissions of their job.
- **US-05** As the operator I do not want to pay for SMS sent by bots.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F01-01 | a valid `+91` mobile number | `POST /auth/otp/request` | `200` `OtpChallenge` with `challengeId`, `expiresInSeconds`, `resendAfterSeconds`; an SMS is handed to the SMS port; the response is identical whether or not an account exists |
| AC-F01-02 | a phone not matching `INDIAN_MOBILE_E164` | request | `400 validation_failed` with `errors[0].field = "phone"`; no SMS |
| AC-F01-03 | a challenge issued less than `resendAfterSeconds` ago for the phone | request again | `429 rate_limited` with `retryAfterSeconds`; no SMS |
| AC-F01-04 | a live challenge and the right code, from a browser | `POST /auth/otp/verify` | `200` `AuthSession` with `accessToken`, `accessTokenExpiresAt`, `me`; **no** `refreshToken` in the body; `Set-Cookie` refresh token is `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` |
| AC-F01-05 | the same with header `X-Client-Platform: native` | verify | body contains `refreshToken`; no cookie is set |
| AC-F01-06 | a live challenge | a wrong code is sent | `400 otp_invalid`; after the 5th ◊ wrong code `429 otp_attempts_exceeded` and the challenge can never succeed |
| AC-F01-07 | a challenge past its expiry, or already used | verify | `400 otp_expired` |
| AC-F01-08 | a phone with no account, `intent: "driver"` | verify succeeds | an account exists with roles `["customer","driver"]`; `me.driver.verificationStatus = "incomplete"`; with `intent: "customer"` (or none) roles are `["customer"]`; an existing customer verifying with `intent: "driver"` gains the driver role |
| AC-F01-09 | `FeatureFlag.DriverSignUp` is false | an account without the driver role verifies with `intent: "driver"` | `403 feature_disabled`; no role added; existing drivers still sign in |
| AC-F01-10 | a valid refresh token | `POST /auth/refresh` | new access token and a new refresh token; the old refresh token is marked used |
| AC-F01-11 | a refresh token that was already used | refresh | `401 unauthenticated`; the whole session is revoked (the newest token no longer works); audit `auth.refresh_reuse_detected` |
| AC-F01-12 | a signed-in user | `POST /auth/logout` | `204`; refresh cookie cleared; that session's refresh token fails; access token is rejected once its `sid` is revoked |
| AC-F01-13 | two sessions | `GET /auth/sessions` then `DELETE /auth/sessions/{other}` | list marks exactly one `current: true`; the other session's next refresh returns `401`; deleting another user's session ID returns `404` |
| AC-F01-14 | a suspended account | verify OTP, refresh, or call any protected route | `403 account_suspended`; no session issued |
| AC-F01-15 | repeated failures for one phone or address beyond the limits in §3 | request or verify | `429 account_locked` or `rate_limited` with `retryAfterSeconds`; audit `auth.otp_lockout` |
| AC-F01-16 | an administrator email with a wrong password, or an unknown email | `POST /auth/admin/login` | `401 invalid_credentials` in both cases, indistinguishable in body and timing class; 5 ◊ failures lock the account (`423`/`429 account_locked`) for 15 min ◊ |
| AC-F01-17 | correct password, MFA enrolled | login | `200 { status: "mfa_required", mfaToken }` and **no session**; `POST /auth/admin/mfa/verify` with a valid TOTP returns `AuthSession` whose `me.admin.permissions` equals `ADMIN_ROLE_PERMISSIONS[adminRole]` |
| AC-F01-18 | correct password, MFA not yet enrolled | login | `200 { status: "mfa_enrollment_required", mfaToken, otpauthUrl, secret }`; verifying the first valid code enrols MFA and returns a session; a wrong code returns `401 mfa_invalid` and enrols nothing |
| AC-F01-19 | an expired or reused `mfaToken`, or a TOTP code already accepted in its window | mfa verify | `401 mfa_invalid` |
| AC-F01-20 | callers of each kind | they call a route outside their rights (matrix in §7) | unauthenticated → `401 unauthenticated`; wrong role or missing permission → `403 forbidden`; another user's resource → `404 not_found` |
| AC-F01-21 | the API configured with the development SMS adapter | started with `NODE_ENV=production` | start-up fails with a clear error; in non-production `OtpChallenge.devCode` is present, in production it is never present |
| AC-F01-22 | an expired access token | any protected route | `401 token_expired`; the web client refreshes once and retries; if refresh fails it returns to sign-in preserving the intended URL |

## 3. Preconditions, postconditions and business rules

**Preconditions** — Redis and PostgreSQL reachable (OTP and login fail closed
otherwise, NFR-REL-004). An SMS adapter is configured.

**Postconditions** — After verify: one `sessions` row, one `refresh_tokens`
row, `users.last_seen_at` updated. After logout or reuse detection: session
`revoked_at` set.

| # | Rule | Value |
| --- | --- | --- |
| BR-01 | OTP is numeric, `OTP_LENGTH` digits, generated with a CSPRNG, stored as a keyed hash | 6 |
| BR-02 | Challenge lifetime | 300 s ◊ |
| BR-03 | Resend cooldown per phone | 30 s ◊ |
| BR-04 | Verification attempts per challenge | 5 ◊ |
| BR-05 | OTP requests | 5 per phone per hour, 20 per IP per hour ◊ (NFR-SEC-007) |
| BR-06 | Phone lockout | 10 failed verifications in 60 min → locked 15 min ◊ |
| BR-07 | Only one live challenge per phone; a new request invalidates the previous one | — |
| BR-08 | Access token: signed JWT carrying `sub`, `sid`, `roles`, and for admins `adminRole`; lifetime | 15 min users, 10 min admins ◊ |
| BR-09 | Refresh token: opaque 256-bit random, stored hashed, rotated on every use; lifetime | 30 days sliding, 90 days absolute (users); 12 h absolute (admins) ◊ |
| BR-10 | Reuse of a rotated refresh token revokes the session | — |
| BR-11 | Permissions are **not** trusted from the token: they are resolved from `adminRole` via `ADMIN_ROLE_PERMISSIONS` on each request | — |
| BR-12 | A revoked session invalidates its access tokens immediately (session check cached ≤ 30 s in Redis) | — |
| BR-13 | Admin password ≥ `ADMIN_PASSWORD_MIN_LENGTH`, Argon2id | 12 |
| BR-14 | TOTP per RFC 6238: SHA-1, 6 digits, 30 s step, ±1 step tolerance, each code usable once | — |
| BR-15 | `mfaToken` is single-purpose, bound to the admin and to the password check, lifetime | 5 min ◊ |
| BR-16 | MFA is mandatory for every `AdminRole`; `super_admin` can never be exempted (A-07) | — |
| BR-17 | Administrator accounts have `phone = null` and cannot use OTP sign-in; phone accounts cannot use admin login | — |
| BR-18 | The driver role is additive and carries no marketplace capability until verification is `approved` (F-05) | — |

## 4. Workflows

**Primary — phone sign-in**

1. User enters phone and (on the partner entry point) driver intent.
2. Client → `POST /auth/otp/request`; shows code entry with a resend timer.
3. User enters the code → `POST /auth/otp/verify` with a `deviceLabel`.
4. Client keeps the access token in memory only and loads `GET /me`
   (already in `AuthSession.me`).
5. On reload the client calls `POST /auth/refresh` (cookie) before rendering
   guarded routes.

**Primary — administrator sign-in**

1. Email + password → `POST /auth/admin/login`.
2. `mfa_enrollment_required`: show the QR (`otpauthUrl`) and secret, ask for a
   code. `mfa_required`: ask for a code.
3. `POST /auth/admin/mfa/verify` → session.

**Alternatives**

| # | Situation | Behaviour |
| --- | --- | --- |
| ALT-1 | SMS not received | Resend enabled after the cooldown; after 3 resends show "check the number" and the support contact from `PublicConfig.support` |
| ALT-2 | Wrong code | Inline error, attempts remaining shown only as "try again"; on exhaustion offer a new code |
| ALT-3 | Refresh fails on app start | Treated as signed out; no error shown on public pages |
| ALT-4 | Access token expires mid-request | Single-flight refresh, original request replayed once |
| ALT-5 | Reuse detected | Client receives `401`, clears state, shows "You were signed out for security" |
| ALT-6 | Number changed / phone lost | Support ticket by another contact route (FR-IAM-015, P2) |
| ALT-7 | Lost authenticator (admin) | A `super_admin` suspends and re-creates the staff account (F-16); no self-service reset |

## 5. Loading, empty, error, retry and offline states

| State | Sign-in screens |
| --- | --- |
| Loading | Submit button shows progress and is disabled; code inputs disabled while verifying |
| Empty | Not applicable (forms). Session list always has ≥ 1 row |
| Error | Field errors from `ProblemDetails.errors`; `otp_invalid`, `otp_expired`, `otp_attempts_exceeded`, `account_locked`, `account_suspended`, `rate_limited` each have their own message; `retryAfterSeconds` drives a countdown |
| Retry | "Send a new code" after expiry/exhaustion; network failures offer "Try again" without clearing the phone field |
| Offline | Form stays editable; submit is disabled with "You're offline — connect to get a code" |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `POST /auth/otp/request` | `OtpRequest` → `OtpChallenge` | public |
| `POST /auth/otp/verify` | `OtpVerifyRequest` → `AuthSession` | public |
| `POST /auth/refresh` | `RefreshRequest` → `AuthSession` | refresh cookie or body token |
| `POST /auth/logout` | — → `204` | user |
| `GET /auth/sessions` | — → `SessionInfo[]` | user |
| `DELETE /auth/sessions/{sessionId}` | — → `204` | user (own sessions) |
| `POST /auth/admin/login` | `AdminLoginRequest` → `AdminLoginResponse` | public |
| `POST /auth/admin/mfa/verify` | `AdminMfaVerifyRequest` → `AuthSession` | public + `mfaToken` |

Tables (see `architecture/data-model.md`): `users`, `otp_challenges`,
`sessions`, `refresh_tokens`, `admin_credentials`. Redis keys: OTP and login
rate counters, lockouts, session-revocation cache, used-TOTP markers.

## 7. Authorisation and security

- Global guard order: request ID → rate limit → authentication → account
  status → role → permission → resource ownership → validation.
- Access matrix (enforced centrally, tested per route):

| Caller | public | `[user]` | `[customer]` | `[driver]` | `[perm:x]` |
| --- | --- | --- | --- | --- | --- |
| Anonymous | ✔ | 401 | 401 | 401 | 401 |
| Customer | ✔ | ✔ | ✔ | 403 | 403 |
| Driver (also customer) | ✔ | ✔ | ✔ | ✔ | 403 |
| Admin without `x` | ✔ | ✔ | 403 | 403 | 403 |
| Admin with `x` | ✔ | ✔ | 403 | 403 | ✔ |

- Threats addressed (see threat model): OTP pumping (T-01), credential
  stuffing on admin login (T-08), token theft via XSS (refresh not readable;
  access token in memory), CSRF on cookie endpoints (NFR-SEC-011),
  enumeration (uniform responses), session fixation (new session ID on every
  sign-in).
- OTP codes, refresh tokens and TOTP secrets never appear in logs or audit
  metadata.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `OtpRequest.phone` | matches `INDIAN_MOBILE_E164` |
| `intent` | `"customer"` \| `"driver"`; optional |
| `OtpVerifyRequest.challengeId` | UUID |
| `code` | exactly `OTP_LENGTH` digits |
| `deviceLabel` | optional, 1–80 chars, control characters stripped |
| `AdminLoginRequest.email` | RFC 5322 address, ≤ 254 chars, lower-cased |
| `password` | 1–200 chars on login (length policy applies on creation) |
| `AdminMfaVerifyRequest.code` | exactly 6 digits |
| `mfaToken` | non-empty opaque string ≤ 2 000 chars |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F01-01 | Unit | OTP generator: length, digits only, no modulo bias |
| UT-F01-02 | Unit | Challenge state machine: live → verified / exhausted / expired |
| UT-F01-03 | Unit | Refresh rotation and reuse detection on the session aggregate |
| UT-F01-04 | Unit | Permission resolver returns exactly `ADMIN_ROLE_PERMISSIONS[role]` for all five roles |
| UT-F01-05 | Unit | TOTP verify: window tolerance, replay rejection |
| UT-F01-06 | Unit (web) | Auth interceptor: single-flight refresh, one replay, no loop on refresh failure |
| IT-F01-01 | Integration | Request → verify → `GET /me` (AC-01, 04, 08) |
| IT-F01-02 | Integration | Cookie attributes; native header variant (AC-04, 05) |
| IT-F01-03 | Integration | Rotation, reuse revocation, logout, session revoke (AC-10…13) |
| IT-F01-04 | Integration | Rate limits and lockout with real Redis (AC-03, 06, 15) |
| IT-F01-05 | Integration | Admin login, enrolment, verify, lockout (AC-16…19) |
| IT-F01-06 | Integration | Route × caller access matrix generated from route metadata (AC-20) |
| E2E-F01-01 | E2E | Customer signs in with the echoed development code and lands on the intended page |
| E2E-F01-02 | E2E | Reload keeps the session; logout returns to public state |
| E2E-F01-03 | E2E | Admin enrols TOTP and reaches the console |
| NT-F01-01 | Negative | Malformed phone, short code, missing fields, unknown properties |
| NT-F01-02 | Negative | Expired, reused, foreign `challengeId` |
| NT-F01-03 | Negative | Tampered JWT, wrong signature, `alg: none`, expired token |
| NT-F01-04 | Negative | Refresh from a disallowed `Origin`; refresh without cookie |
| NT-F01-05 | Negative | Suspended account on every auth path (AC-14) |
| NT-F01-06 | Negative | Production start-up with development SMS adapter (AC-21) |

## 10. Performance and accessibility

- `otp/verify` and `refresh` p95 ≤ 300 ms; Argon2id tuned to ≈ 100 ms on the
  production instance class (admin login only).
- Code input: one field with `inputmode="numeric"`, `autocomplete="one-time-code"`,
  paste-friendly; no auto-submit that surprises screen-reader users (submit
  button remains).
- Errors are associated with fields (`aria-describedby`) and announced via a
  polite live region; the resend countdown is not announced every second.
- QR code for TOTP has the secret as selectable text alongside.

## 11. Deployment, rollback and observability

- **Config**: JWT signing key, token hash key, TOTP encryption key (Secrets
  Manager); token lifetimes; OTP limits; SMS adapter selection; allowed
  origins; cookie domain.
- **Migration**: creates the five tables. **Rollback**: drop in reverse; no
  data loss concern before launch. Key rotation: signing keys are identified
  by `kid`; two keys are accepted during rotation.
- **Metrics**: OTP requested / delivered / verified / failed; lockouts; refresh
  success / reuse; admin login failures; MFA failures.
- **Alerts**: OTP request rate > 5× baseline; refresh reuse > 0 sustained;
  admin lockouts.
- **Audit actions**: `auth.otp_lockout`, `auth.login`, `auth.logout`,
  `auth.session_revoked`, `auth.refresh_reuse_detected`, `auth.admin_login`,
  `auth.admin_login_failed`, `auth.mfa_enrolled`, `auth.mfa_failed`.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | **No change-password operation** in `ApiRoutes`, although `CreateStaffRequest.temporaryPassword` requires the member to change it on first sign-in. Until added, a temporary password remains in use — treat as an R1.1 blocker for staff other than the seeded `super_admin`. |
| G-2 | **No email sign-in / linking operations** (§6.M1-2). `email` is an attribute set through `PATCH /me` only and is unverified. |
| G-3 | **No recovery operation** (§5.A-1). Phone OTP is its own recovery while the user holds the number; otherwise support handles it manually. |
| G-4 | `AdminLoginResponse` has no way to express "password change required". |
| G-5 | International numbers are excluded by `INDIAN_MOBILE_E164` (owner decision D-09). |
| A-1 | Values marked ◊ are defaults; the implementation's configuration is authoritative. |
| A-2 | MFA is mandatory for all admin roles (A-07 in the PRD). |
