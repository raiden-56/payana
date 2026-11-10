# F-17 — PWA, offline and mobile readiness

| | |
| --- | --- |
| Requirements | FR-PWA-001 … FR-PWA-009 |
| Priority / release | P0 PWA shell, offline states, adapters, honest capability statements; P1 update prompt; P2 Capacitor packaging and native capabilities · R1 |
| Source | Brief §4 Frontend ("Progressive Web App capabilities"), §4 Mobile strategy |
| Web | service worker configuration, web manifest, `core/platform` (adapters), shell (offline banner, update prompt) |
| ADRs | 0007 PWA first, Capacitor later · 0003 token strategy · 0012 polling |

## 1. Business objective and scope

Most customers will arrive from a link on a phone with a weak signal. The web
client must install, start fast, survive losing the network, and be honest
about what a browser cannot do — while being structured so Android and iOS
apps can be added without rewriting domain logic.

**In scope** — installability; service-worker caching strategy; offline
detection and behaviour; update flow; platform adapters for every
browser-only API; foreground geolocation permission handling; capability
statements in the product.
**Out of scope at R1 (specified, P2)** — Capacitor/Ionic packaging; native
push; deep links / app links; secure native token storage; camera capture
via native plugin; background location.

## 2. User stories and acceptance criteria

- **US-01** As a visitor I add Payana to my home screen and it opens like an app.
- **US-02** With no signal I still see my confirmed booking's driver and plate.
- **US-03** I am never told an action worked when it did not reach the server.
- **US-04** As a driver I am told plainly that I must keep the app open to
  receive requests.
- **US-05** As an engineer I can add a native shell without touching domain code.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F17-01 | the production build served over HTTPS | audited (Lighthouse PWA / installability checks) | a valid web manifest (name, short name, `start_url`, `display: standalone`, theme and background colours from the F-13 palette, 192 px and 512 px icons incl. maskable) and a registered service worker exist; the browser offers install |
| AC-F17-02 | the app has been opened once online | the device goes offline and the app is reopened | the application shell loads (navigation, fonts, icons, illustrations); the last-fetched regions, vehicle categories, places, plans and packages are available; an OfflineBanner is shown |
| AC-F17-03 | offline | the user opens a screen whose data was never fetched | the shared offline EmptyState appears with a *Try again* that works on reconnect — never an infinite loader or a blank page |
| AC-F17-04 | offline | the user attempts any write (request, quote, accept, cancel, availability, upload, settings) | the control is disabled or the attempt is refused locally with "You're offline — this needs a connection"; **nothing is queued for later** (sole exception: notification mark-read, F-15); form input is preserved |
| AC-F17-05 | a booking detail viewed while online | the device goes offline | the last copy remains readable for the session with an "Offline — last updated HH:mm" marker; it is held in memory/state only — API responses containing personal data are not written to Cache Storage |
| AC-F17-06 | the service worker's cache configuration | inspected | no request under `/api/v1/auth`, `/api/v1/me`, `/api/v1/bookings`, `/api/v1/ride-requests`, `/api/v1/driver`, `/api/v1/admin`, `/api/v1/notifications`, `/api/v1/support`, `/api/v1/uploads`, `/api/v1/files` is cached; only the public catalogue endpoints are (stale-while-revalidate, ≤ 24 h) and `/public/config` (network-first, 60 s) |
| AC-F17-07 | a new version is deployed while a tab is open | the service worker detects it | a non-blocking prompt "A new version is ready — Reload" appears; nothing reloads by itself mid-task; after reload the new version runs |
| AC-F17-08 | geolocation in each permission state (`prompt`, `granted`, `denied`, unsupported, timeout, low accuracy) | a feature asks for the position through the adapter | the adapter resolves a typed result for each case; the UI shows the matching explanation and a fallback (region/place picker); the permission prompt is triggered only by a user gesture, never on page load |
| AC-F17-09 | the web codebase | statically scanned | `navigator.*`, `window.*`, `localStorage`, `sessionStorage`, `document.cookie`, `Notification`, `caches` and `gtag` are referenced only inside `core/platform` and `core/analytics` adapter implementations; features and domain code depend on the adapter interfaces (lint rule) |
| AC-F17-10 | the partner dashboard and onboarding | viewed in a browser/PWA | a persistent note states that new requests and location sharing work **while the app is open and on screen**, and that background alerts will come with the Android/iOS app; no copy anywhere calls the PWA "the app from the store" or promises background tracking |
| AC-F17-11 | the access token | the app is installed, reloaded, or opened offline | the token is never in `localStorage`, `sessionStorage`, IndexedDB or Cache Storage; after reload the session is restored only by `POST /auth/refresh` (cookie); offline, the user sees public/cached content and a "sign-in will resume when you're back online" note |
| AC-F17-12 | connectivity flaps during a request | the request fails with a network error | idempotent reads are retried with back-off; `(idem)` writes are retried with the **same** `Idempotency-Key`; other writes are not retried automatically |

## 3. Preconditions, postconditions and business rules

### 3.1 Caching strategy

| Resource | Strategy | Lifetime |
| --- | --- | --- |
| App shell (HTML, JS, CSS, fonts, icon sprite, illustrations) | Precache, versioned by build hash | Until the next version activates |
| `GET /regions`, `/vehicle-categories`, `/places`, `/plans`, `/packages`, `/packages/{slug}` | Stale-while-revalidate | 24 h, ≤ 100 entries |
| `GET /public/config` | Network-first, 3 s timeout, fall back to cache then to the static file | 60 s freshness |
| `GET /drivers`, `/drivers/{id}`, `/drivers/{id}/reviews`, `/fare-estimate`, `/ads` | Network-only (live or position-dependent) | — |
| Everything authenticated | Network-only, never cached | — |
| User-uploaded images (public vehicle/driver photos) | Cache-first | 7 days, ≤ 60 entries |

### 3.2 Platform adapters (ports)

| Port | Web adapter (R1) | Native adapter (P2, Capacitor) |
| --- | --- | --- |
| `GeolocationPort` | `navigator.geolocation` + Permissions API | `@capacitor/geolocation` (+ background plugin for drivers) |
| `StoragePort` (non-secret preferences, drafts) | `localStorage` with in-memory fallback | `@capacitor/preferences` |
| `SecureTokenStore` | none — refresh token lives in the HttpOnly cookie | Keychain / Keystore-backed plugin holding the refresh token (`X-Client-Platform: native`) |
| `NetworkPort` | `navigator.onLine` + `online`/`offline` events + request outcome heuristics | `@capacitor/network` |
| `SharePort` | Web Share API with copy-link fallback | `@capacitor/share` |
| `CameraPort` | `<input type="file" accept capture>` | `@capacitor/camera` |
| `PushPort` | no-op at R1 | FCM / APNs via `@capacitor/push-notifications` |
| `DeepLinkPort` | router URLs | App Links / Universal Links |
| `AnalyticsPort` | gtag adapter (F-14) | native Firebase/GA adapter or no-op |
| `ClipboardPort`, `HapticsPort` | Clipboard API / no-op | native plugins |

### 3.3 Rules

| # | Rule |
| --- | --- |
| BR-01 | The service worker is enabled only in production builds and only on HTTPS. |
| BR-02 | Personal data is never persisted by the service worker (AC-05, AC-06) — a shared or lost phone must not reveal bookings from cache. |
| BR-03 | Writes are never queued offline. A ride request that "sends later" could dispatch a driver to a pickup nobody is waiting at. |
| BR-04 | Online status is advisory: the app also treats a failed request with no response as offline for that action, and recovers on the next success. |
| BR-05 | Updates never interrupt a task: prompt only; activation on user reload (or on next cold start). |
| BR-06 | Geolocation is requested only on a user gesture, with a pre-prompt explanation; a denial is respected and never re-prompted automatically. |
| BR-07 | **What the PWA cannot do, stated in product copy and in ADR-0007:** background location updates; reliable push when the browser is closed (and on iOS only for installed PWAs, with user opt-in, and not at R1); reading SMS OTP automatically everywhere (`autocomplete="one-time-code"` and WebOTP are progressive enhancements); guaranteed persistence of storage. |
| BR-08 | Shared code (domain models, validators, API client, stores, most components) contains no direct platform API and no `window` access, so the same build can run inside a Capacitor WebView with adapters swapped by dependency injection. |
| BR-09 | The API client is the single place that sets `X-Client-Platform`, `Idempotency-Key` and handles refresh; it is platform-neutral. |
| BR-10 | Install prompts are passive: an "Install" menu item appears when the browser reports installability; no pop-up nags. |

## 4. Workflows

**First visit** — shell loads from network → service worker installs and
precaches → catalogue requests populate the runtime cache.
**Repeat visit / offline** — shell from cache → refresh attempt → data
network-first/network-only per table → offline states where needed.
**Update** — new worker waits → prompt → reload → new worker activates.
**Native build (P2)** — add Capacitor platforms → provide native adapters →
switch token transport to the body + secure store → register push → map deep
links to router URLs.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Storage unavailable (private mode / quota) | `StoragePort` falls back to memory; drafts are session-only |
| ALT-2 | Service worker unsupported | App works as a normal web app; no offline shell |
| ALT-3 | Captive portal (connected, no internet) | Requests fail → treated as offline per BR-04 |
| ALT-4 | Broken update (new version fails to boot) | The previous worker keeps serving until the user reloads; server keeps the previous build's hashed assets for ≥ 7 days ◊ |

## 5. Loading, empty, error, retry and offline states

This feature defines the offline half of the shared states (F-13 §5):

| State | Behaviour |
| --- | --- |
| Loading | Shell paints immediately from cache; data regions show skeletons |
| Empty (offline, no cache) | Offline illustration, "You're offline", *Try again* |
| Error | Network error vs. server error are distinguished: the former shows the offline pattern, the latter the ErrorState with `traceId` |
| Retry | Back-off 1 s, 3 s, 9 s for reads; one automatic retry on reconnect for the visible screen |
| Offline | Persistent banner; disabled writes with explanation; cached catalogue marked "may be out of date" |

## 6. API and database changes

None. Uses `CLIENT_PLATFORM_HEADER` (`X-Client-Platform`) and
`RefreshRequest.refreshToken` for native clients (F-01).

## 7. Authorisation and security

- Token handling per ADR-0003: access token in memory; refresh token in an
  HttpOnly cookie (web) or the platform secure store (native). Nothing
  sensitive in web storage or caches (AC-11).
- The service worker is same-origin, served with a short cache lifetime and
  a restrictive scope; it caches only allow-listed URL patterns.
- Logout clears in-memory state, the runtime cache entries for images of the
  user's own uploads, and any drafts in `StoragePort`.
- Geolocation: `Permissions-Policy: geolocation=(self)`; positions go only to
  Payana's API (NFR-PRIV-002).
- Native (P2): certificate pinning is evaluated then; WebView debugging is
  disabled in release builds; deep links are validated against the route
  table.

## 8. Validation rules

| Item | Rule |
| --- | --- |
| Manifest | `name` ≤ 45 chars, `short_name` ≤ 12; icons 192/512 PNG + maskable; `theme_color` and `background_color` from tokens (no blue/purple, F-13 BR-01) |
| Cache allow-list | exact path patterns in §3.1; anything else is network-only |
| Geolocation result | accuracy > 2 000 m is treated as "approximate" and the UI asks the user to confirm or pick a place |
| Stored drafts | versioned schema; unknown versions are discarded |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F17-01 | Unit | Each web adapter: happy path, unsupported API, permission denied, timeout |
| UT-F17-02 | Unit | Network status service: events + request-outcome heuristic |
| UT-F17-03 | Unit | Retry policy: reads vs. `(idem)` writes vs. other writes (AC-12) |
| UT-F17-04 | Unit (lint) | No forbidden globals outside adapters (AC-09) |
| UT-F17-05 | Unit | Service-worker config: authenticated paths are absent from every cache group (AC-06) |
| E2E-F17-01 | E2E | Installability audit on the production build (AC-01) |
| E2E-F17-02 | E2E | Online visit → offline → reload: shell + cached catalogue + banner (AC-02) |
| E2E-F17-03 | E2E | Offline write attempts are refused and nothing is sent after reconnect (AC-04) |
| E2E-F17-04 | E2E | Booking stays readable offline in-session; Cache Storage contains no booking payload (AC-05) |
| E2E-F17-05 | E2E | New build → update prompt → reload (AC-07) |
| E2E-F17-06 | E2E | Geolocation granted / denied / timeout paths (AC-08) |
| NT-F17-01 | Negative | Storage inspection after sign-in: no token anywhere (AC-11) |
| NT-F17-02 | Negative | Service worker absent/unsupported: app fully functional online |

## 10. Performance and accessibility

- Repeat-visit shell paint ≤ 1 s on the reference device (from cache).
  Precache size ≤ 1.5 MB ◊ (admin chunks excluded; they load on demand).
- Offline and update prompts are announced via live regions, are not
  focus-stealing, and are dismissible by keyboard; the offline banner does
  not cover content (it pushes it down or sits in reserved space).

## 11. Deployment, rollback and observability

- **Deploy**: hashed static assets with long cache; `index.html`, the
  service worker script and the manifest with `no-cache`. Old hashed assets
  are retained ≥ 7 days.
- **Rollback**: redeploy the previous build; clients update through the
  normal prompt. Emergency: a "kill-switch" worker (unregisters itself and
  clears caches) is kept ready in the repository and documented in the
  release plan.
- **Observability**: `pwa_installed` and display-mode dimension through F-14;
  count of offline banner activations (local metric surfaced in Web Vitals
  events as a boolean).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | Capacitor packaging, push, deep links, secure storage, native camera and background location (FR-PWA-006, -007) are **specified but not built** in R1. |
| G-2 | No push-token registration contract (see F-15 G-1). |
| G-3 | Web Push for installed PWAs is not planned for R1; it is an option to evaluate before native apps. |
| G-4 | No app-store assets, signing or distribution plan yet. |
| A-1 | Cache lifetimes and size caps are defaults. |
| A-2 | Ionic UI components are **not** adopted (ADR-0008); Capacitor alone provides packaging and plugins. |
