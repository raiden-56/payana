# ADR-0003 — In-memory access token + HttpOnly rotating refresh token

*Status: accepted · 2026-11-10 · Source: brief §6 Module 1 (sessions, refresh tokens, revocation), §4 Mobile (secure token storage)*

## Context

The web client is a single-page app exposed to XSS risk like any other; the
same API must later serve native apps. Sessions must survive reloads, be
revocable, and be listable per device. Token theft should be detectable.

## Decision

1. **Access token**: signed JWT, 15 minutes (10 for administrators), holding
   `sub`, `sid`, `roles`, and `adminRole` where relevant. On the web it is
   kept **in memory only** — never in `localStorage`, `sessionStorage`,
   IndexedDB or a readable cookie.
2. **Refresh token**: opaque 256-bit random value, stored server-side only as
   a keyed hash, **rotated on every use**.
   - Browsers receive it solely as a cookie: `HttpOnly; Secure;
     SameSite=Strict; Path=/api/v1/auth`.
   - Native clients send `X-Client-Platform: native`, receive it in the
     response body (`AuthSession.refreshToken`) and keep it in the platform
     secure store; they send it back in `RefreshRequest.refreshToken`.
3. **Reuse detection**: presenting a refresh token that was already rotated
   revokes the whole session and is audited.
4. **Revocation**: logout, user-initiated session revoke, suspension, staff
   role change and reuse detection set `revoked_at`; a short-lived Redis flag
   makes outstanding access tokens for that `sid` fail immediately.
5. **Permissions are not in the token**: they are derived per request from
   `adminRole` through `ADMIN_ROLE_PERMISSIONS`.
6. **CSRF**: only `/auth/refresh` and `/auth/logout` are cookie-authenticated.
   They are protected by `SameSite=Strict`, an `Origin` allow-list and a JSON
   content-type requirement. All other routes use the `Authorization` header
   and are not CSRF-prone.
7. Web and API share a site (same origin via the CDN path route, or sibling
   subdomains) so the cookie is first-party.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Access + refresh tokens in `localStorage` | Any XSS exfiltrates a long-lived credential |
| Server-side cookie session for everything | Works for web; awkward for native; every route becomes CSRF-relevant |
| Long-lived JWT, no refresh | No revocation, no device list |
| Backend-for-frontend holding tokens | More infrastructure than a single SPA + API justifies at launch |
| Refresh token in body for web too | Readable by script; loses the main XSS mitigation |

## Consequences

- **Good**: an XSS can use the session while the page is open but cannot
  steal a durable credential; stolen refresh tokens are detected on reuse.
- **Cost**: a refresh round-trip on every page load before guarded content
  renders (≈ one request); single-flight refresh logic in the client.
- **Constraint**: web and API must be same-site; local development uses the
  Angular dev-server proxy.
- **Offline**: an installed PWA opened offline cannot restore the session
  until it is online (F-17 AC-11) — accepted.
- **Operational**: signing keys are rotated by `kid`; two keys are valid
  during rotation.
