# Payana — Non-Functional Requirements

*Version 1.0 · 2026-11-10 · 62 requirements*

Each requirement is measurable and names how it is verified. "Reference
device" means a mid-range Android phone (4 GB RAM, Chrome) on a throttled
connection equivalent to Lighthouse "Slow 4G" (1.6 Mbps down, 150 ms RTT, 4×
CPU slowdown). "R1 load" means the capacity target in NFR-SCAL-002.

Numbers marked ◊ are engineering targets chosen for these specs, not values
given by the owner. They are the default until measured otherwise.

## 1. Performance — PERF

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-PERF-001 | API server time at R1 load: p95 ≤ 300 ms for reads and ≤ 600 ms for writes, p99 ≤ 1 500 ms, excluding third-party calls. ◊ | Load test (k6) against staging; latency histogram per route |
| NFR-PERF-002 | Nearby search (`GET /drivers` with `lat`,`lng`,`radiusKm`) p95 ≤ 150 ms database time with 5 000 published drivers and 20 concurrent searches; the query plan uses the GiST index on `driver_locations.location`. ◊ | Seeded benchmark; `EXPLAIN (ANALYZE)` asserted in an integration test |
| NFR-PERF-003 | Core Web Vitals on the reference device for `/`, `/explore` and `/requests/:id`: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. | Lighthouse CI on every build; field data from GA4 Web Vitals once enabled |
| NFR-PERF-004 | Bundle budgets (compressed transfer size): initial JavaScript ≤ 220 kB, any lazy route chunk ≤ 120 kB, global CSS ≤ 40 kB, fonts ≤ 120 kB total and subset. The admin area is never part of the customer initial bundle. ◊ | `angular.json` budgets (error level) fail the build |
| NFR-PERF-005 | Animation runs on the compositor: only `transform`, `opacity`, `clip-path` and SVG stroke properties are animated; no scroll handler does layout work; no long task > 50 ms is caused by scroll-linked effects on the reference device. | Code review rule; Chrome performance trace in the e2e performance suite |
| NFR-PERF-006 | Accepting a quotation (`POST …/quotes/{id}/accept`) completes in p95 ≤ 500 ms and holds its row lock for < 100 ms p95. ◊ | Integration timing test; lock wait metric |
| NFR-PERF-007 | Public reference responses (`/regions`, `/vehicle-categories`, `/places`, `/plans`, `/packages`, `/public/config`) send `Cache-Control` and `ETag`; `/public/config` is cacheable for at most 60 s so that settings changes propagate within one minute. | Integration test on headers |

## 2. Security — SEC

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-SEC-001 | All traffic uses TLS 1.2 or later; HTTP redirects to HTTPS; `Strict-Transport-Security` ≥ 1 year with `includeSubDomains`. | Infrastructure test; header test |
| NFR-SEC-002 | Authorisation is default-deny: an endpoint with no declared access rule fails start-up or CI. Every protected route has at least one negative authorisation test. | Start-up assertion + route/permission matrix test |
| NFR-SEC-003 | No secret, credential, private key or real identifier is committed. Secrets are injected from AWS Secrets Manager / environment. | Secret scanning in CI (gitleaks) |
| NFR-SEC-004 | Administrator passwords are hashed with Argon2id; OTP codes and refresh tokens are stored only as keyed hashes; TOTP secrets are encrypted at rest with a key from the secret store. | Unit tests; schema review |
| NFR-SEC-005 | Responses carry `Content-Security-Policy` (no `unsafe-eval`; script sources limited to self and the fixed allow-list of Google tag, Analytics, Ads and AdSense origins that F-14 may load at run time — the allow-list is static because identifiers are run-time configuration; whether anything is requested is decided by the client per F-14 BR-01/BR-05), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, and a restrictive `Permissions-Policy` (geolocation self only). | Header test; CSP report-only period before enforcement |
| NFR-SEC-006 | Request validation is allow-list based: unknown properties are rejected, strings have maximum lengths, numbers have ranges, enums are closed. | Negative tests per endpoint |
| NFR-SEC-007 | Rate limits (defaults, configurable) ◊: OTP request 5 per phone per hour and 20 per IP per hour; OTP verify 5 attempts per challenge; admin login 5 failures per account per 15 min then lock 15 min; ad impression/click 60 per IP per minute; general API 300 requests per IP per minute, 120 per user per minute for writes. Exceeding returns `429 rate_limited` with `retryAfterSeconds`. | Integration tests against Redis |
| NFR-SEC-008 | Uploaded files: content type in `UPLOAD_ALLOWED_CONTENT_TYPES`, size ≤ `UPLOAD_MAX_BYTES`, stored in a private bucket under unguessable keys, never served from the web origin, readable only through signed URLs valid ≤ 5 minutes (admin document view) or ≤ 10 minutes (upload). Magic-byte check on attach. Malware scanning is an R1.1 item. | Integration tests; bucket policy test |
| NFR-SEC-009 | Dependencies are pinned by lockfile; CI fails on known high or critical vulnerabilities in production dependencies. | `npm audit --omit=dev --audit-level=high` gate |
| NFR-SEC-010 | The audit log is append-only: the application role has no `UPDATE` or `DELETE` privilege on `audit_logs`. | Migration test; privilege check |
| NFR-SEC-011 | Cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) are protected against CSRF by `SameSite=Strict`, an `Origin`/`Referer` allow-list check and a JSON content-type requirement. CORS allows only configured origins and never `*` with credentials. | Negative tests |
| NFR-SEC-012 | An independent penetration test is completed and its high/critical findings closed before public launch. | Release checklist item (R1.1) |

## 3. Privacy — PRIV

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-PRIV-001 | Every column holding personal data is classified in `architecture/data-model.md` (none / personal / sensitive) and has a stated purpose. No personal data is collected without one. | Data-model review at each migration |
| NFR-PRIV-002 | Driver position: only the latest fix is stored; there is no location history. Customer device position is used in the request it is sent with and is never stored except as the pickup/drop of a ride request. | Schema review; integration test that a second ping overwrites the first |
| NFR-PRIV-003 | Retention ◊ (subject to D-03, D-13): OTP challenges 24 h; idempotency keys 24 h; expired/revoked sessions 30 days; `ad_events` raw rows 90 days; notifications 180 days; processed outbox rows 14 days; driver documents 180 days after profile closure; audit logs 2 years; bookings, invoices and their events 8 years with personal fields anonymised on account erasure. | Scheduled purge jobs with tests; retention table kept in the privacy notice |
| NFR-PRIV-004 | No analytics or advertising script, cookie or request is issued before consent when `requireConsent` is true. | e2e test asserting zero requests to Google origins pre-consent |
| NFR-PRIV-005 | Logs, traces, metrics labels and analytics events contain no phone numbers, names, emails, document numbers, OTPs, tokens or coordinates. Phone numbers that must appear for operations are masked to the last 4 digits. | Log-scrubbing unit tests; code review rule |
| NFR-PRIV-006 | An erasure request is completed within `ACCOUNT_DELETION_GRACE_DAYS` + 30 days and is itself evidenced in the audit log without retaining the erased data. | Job test; audit assertion |
| NFR-PRIV-007 | Production personal data is stored and processed in AWS `ap-south-1` (India); any cross-border processor (for example Google, when enabled) is disclosed in the privacy notice. | Terraform variables; notice review |

## 4. Accessibility — A11Y

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-A11Y-001 | The web client conforms to WCAG 2.2 level AA. | Automated axe scan + manual audit checklist per release |
| NFR-A11Y-002 | Every function is operable by keyboard alone; focus order follows reading order; a visible focus indicator with ≥ 3:1 contrast is always present; dialogs trap and restore focus. | Keyboard e2e tests; manual pass |
| NFR-A11Y-003 | Text contrast ≥ 4.5:1 (≥ 3:1 for text ≥ 24 px or ≥ 18.66 px bold); non-text UI and graphical objects ≥ 3:1. Colour is never the only carrier of meaning. | Token contrast unit test; axe |
| NFR-A11Y-004 | Under `prefers-reduced-motion: reduce` there is no parallax, no scroll-linked movement, no auto-playing loop and no transition longer than 150 ms; content that would have been revealed is simply visible. | e2e with reduced-motion emulation |
| NFR-A11Y-005 | Interactive targets are at least 44 × 44 CSS px on touch layouts (never below the WCAG 2.2 minimum of 24 × 24). | Visual regression + design-token rule |
| NFR-A11Y-006 | CI fails on any axe violation of impact `serious` or `critical` on the audited routes. Status changes (new quote, booking status, form errors) are announced through live regions. | Playwright + axe gate |

## 5. Reliability — REL

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-REL-001 | API availability ≥ 99.5 % per calendar month, measured at the load balancer, excluding announced maintenance. ◊ | Uptime monitor; SLO dashboard |
| NFR-REL-002 | Database recovery point ≤ 5 minutes (point-in-time recovery) and recovery time ≤ 60 minutes; restore is rehearsed before launch and quarterly. ◊ | Restore drill record |
| NFR-REL-003 | Repeating an `(idem)` request with the same key and body returns the first result and creates nothing; the same key with a different body returns `409 idempotency_key_reused`. | Integration tests incl. concurrent duplicates |
| NFR-REL-004 | Dependency failure is contained: if Redis is unavailable, OTP request/verify and admin login fail closed (`503 upstream_unavailable`) while public read endpoints continue without rate limiting for at most 5 minutes before shedding load; if object storage is unavailable only upload and document-view operations fail. | Fault-injection integration tests |
| NFR-REL-005 | Outbox delivery is at-least-once; every handler is idempotent; a failing event is retried with exponential back-off up to 10 attempts and then parked for inspection without blocking later events. | Integration tests |
| NFR-REL-006 | Deployments are rolling with zero planned downtime; every migration is compatible with the previous application version (expand → migrate → contract). | Pipeline check: previous release's test suite runs against the migrated schema |

## 6. Observability — OBS

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-OBS-001 | Every request produces one structured JSON log line with: timestamp, level, `requestId`, method, route template, status, duration, user ID (if any), role, and error code (if any). | Log schema test |
| NFR-OBS-002 | Metrics: request rate / errors / duration per route template; database pool usage; Redis latency; outbox lag and parked count; job run duration and outcome; OTP requests / verifications / lockouts; open requests; quotes per request; time to first quote. | Metrics endpoint test; dashboard exists |
| NFR-OBS-003 | Distributed tracing (OpenTelemetry) covers HTTP → use case → database / Redis / storage with the request ID as a span attribute. (P1) | Trace visible in staging |
| NFR-OBS-004 | Alerts page the on-call for: 5xx rate > 2 % for 5 min; p95 latency > 2× target for 10 min; readiness failing > 2 min; outbox lag > 5 min; OTP request rate > 5× baseline (possible SMS pumping); any refresh-token-reuse spike. | Alert rules in Terraform |
| NFR-OBS-005 | Client-side errors and Web Vitals are reported (to GA4 when enabled; a first-party error endpoint is P2). | Manual verification |

## 7. Scalability — SCAL

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-SCAL-001 | The API is stateless (all shared state in PostgreSQL, Redis or object storage) and runs correctly with ≥ 2 instances; scheduled jobs take a distributed lock so each runs once. | Two-instance integration run |
| NFR-SCAL-002 | R1 capacity target: 5 000 listed drivers, 50 000 monthly active customers, 200 concurrent users, 50 requests/s peak, across 5 regions. The design carries 10× without re-architecture (read replicas, extraction per ADR-0001). ◊ | Load test at 1×; capacity review at 3× |
| NFR-SCAL-003 | Adding a region is a data operation taking effect within the configuration cache window, with no deployment. | Runbook rehearsal in staging |
| NFR-SCAL-004 | Modules do not query one another's tables; cross-module calls go through exported services or events, so any module can be extracted. | Lint rule on import paths; architecture test |

## 8. Maintainability — MAINT

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-MAINT-001 | TypeScript `strict` everywhere; no `any` in domain or application layers; lint passes with zero warnings. | CI |
| NFR-MAINT-002 | Line coverage ≥ 80 % for `domain` and `application` layers of the API and ≥ 70 % overall; ≥ 60 % for web `core` and feature stores. ◊ | Coverage gate |
| NFR-MAINT-003 | All dependencies are pinned to exact versions in lockfiles; upgrades are deliberate changes. | CI uses `npm ci` |
| NFR-MAINT-004 | Each significant technical decision has an ADR; superseded ADRs are kept and marked. | Review checklist |
| NFR-MAINT-005 | The committed `specs/api/openapi.yaml` equals the document exported from the code. | CI drift check |

## 9. Internationalisation — I18N

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-I18N-001 | No user-facing string is hard-coded in a component template or API response title intended for display; all are keyed so `kn` and `hi` can be added by supplying translations. English ships at R1. | Lint rule; pseudo-locale run |
| NFR-I18N-002 | Dates and times are stored in UTC and displayed in `Asia/Kolkata`; money is formatted with the `en-IN` grouping (₹1,23,456) from minor units. | Unit tests |
| NFR-I18N-003 | Typography renders Kannada and Devanagari without tofu: font stacks include script fallbacks, and layouts tolerate 40 % longer strings and taller line boxes. | Visual check with pseudo-locale and sample Kannada strings |
| NFR-I18N-004 | Storage and transport are UTF-8; `Region.nameLocal` and free-text fields accept Kannada and Devanagari; search on labels is case- and accent-insensitive. | Integration test |

## 10. Compliance — COMP

These state what the system must *support*. Whether and how each obligation
applies is a question for qualified counsel or a tax adviser
(`product-requirements.md` D-03, D-04, D-10). **Nothing here is legal advice.**

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-COMP-001 | The system supports the obligations of a Data Fiduciary under the Digital Personal Data Protection Act, 2023 as they are advised to apply: itemised notice, recorded consent with withdrawal, access/correction, erasure, breach handling, and a published grievance contact. | Counsel sign-off (R1.1) |
| NFR-COMP-002 | OTP and transactional SMS are sent only through a DLT-registered header and template (TRAI). | Provider onboarding record (R1.1) |
| NFR-COMP-003 | Invoices can carry the tax fields an adviser requires (GSTIN, SAC, tax breakdown). `Invoice` has none today — recorded as a contract gap. | Adviser sign-off (R1.1) |
| NFR-COMP-004 | The product's behaviour is documented precisely enough (who sets price, who dispatches, who collects) for counsel to assess aggregator-licensing obligations. | `product-requirements.md` §3, §8 reviewed by counsel |
| NFR-COMP-005 | Google integrations follow Google's requirements: Consent Mode v2 signals for advertising features, no PII in Analytics, AdSense programme policies and `ads.txt` when AdSense is enabled. | F-14 acceptance tests; policy checklist |
| NFR-COMP-006 | Paid placement is disclosed: featured listings, plan badges and advertisements are labelled in the UI. | Visual acceptance in F-06, F-12 |

## 11. Budget summary

| Budget | Target |
| --- | --- |
| API p95 read / write | 300 ms / 600 ms |
| Nearby search DB p95 | 150 ms @ 5 000 drivers |
| LCP / INP / CLS | 2.5 s / 200 ms / 0.1 |
| Initial JS / lazy chunk / CSS | 220 kB / 120 kB / 40 kB |
| Availability | 99.5 % |
| RPO / RTO | 5 min / 60 min |
| Config propagation | ≤ 60 s |
| Signed URL lifetime | ≤ 5 min view, ≤ 10 min upload |
