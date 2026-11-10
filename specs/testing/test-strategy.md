# Payana — Test Strategy

*Version 1.0 · 2026-11-10*

Testing exists to prove the acceptance criteria in `specs/features/` and the
budgets in `non-functional-requirements.md`. A requirement is `built` only
when the tests listed for it in `traceability-matrix.md` exist and pass.

## 1. Principles

1. **Test behaviour at the boundary where it is promised.** Rules in the
   domain → unit tests. HTTP contract, authorisation, SQL, locking and
   idempotency → integration tests against real PostgreSQL + PostGIS and
   Redis. User journeys → a small number of browser tests.
2. **No mocked database.** Repositories, spatial queries, row locks and
   migrations are only meaningful against PostgreSQL. There is no in-memory
   substitute for PostGIS and none is used.
3. **Negative tests are first-class.** Every protected route has at least
   one authorisation failure test; every validated field has a rejection.
4. **Generated matrices beat hand-written lists** for cross-cutting
   guarantees: access control, audit coverage and OpenAPI coverage are
   derived from route metadata so a new route cannot escape them.
5. **Deterministic.** Time, randomness, IDs and the SMS/payment/storage
   adapters are injectable; tests control the clock.
6. **Honest reporting.** A skipped or unwritten test is recorded as such in
   the traceability matrix — never implied.

## 2. Test pyramid

| Level | Share ◊ | Scope | Runs | Speed target |
| --- | --- | --- | --- | --- |
| Unit (API) | ~55 % | `domain` and `application` classes with in-memory fakes of ports: state machines, policies, calculators, validators | every push | < 30 s |
| Unit (web) | ~15 % | stores, services, adapters, pure components, validators, analytics event builder | every push | < 60 s |
| Integration (API) | ~25 % | HTTP → controller → use case → real PostgreSQL/PostGIS + Redis, development adapters for SMS/payments/storage | every push | < 5 min |
| Contract | — | Exported OpenAPI vs. committed file; every `ApiRoutes` path present; access declarations | every push | < 30 s |
| End-to-end (browser) | ~5 % | Critical journeys through the built web app against a seeded API | PR (smoke), nightly (full) | smoke < 5 min |
| Non-functional | — | Accessibility, performance, palette, bundle budgets, security scans | PR / nightly as listed in §8 | — |

## 3. Tools

| Purpose | Tool | Notes |
| --- | --- | --- |
| API unit and integration | **Jest** + **supertest** | Integration suites boot the Nest application in-process and call it over HTTP |
| Database for tests | PostgreSQL 17 + PostGIS 3.5 container | Local: Docker Compose service on port 5439. CI: service container. One schema per Jest worker, migrated once, truncated between tests |
| Redis for tests | Redis 7 container | Key prefix per worker; flushed between tests |
| Web unit | Angular's unit test runner as configured by `ng new` for Angular 22, with Angular Testing Library-style queries | Zoneless-compatible; no real HTTP (HttpTestingController) |
| End-to-end | **Playwright** | Chromium by default (system Chrome channel locally to avoid downloads); mobile viewport projects 360×800 and desktop 1280×800; geolocation, permissions, offline and reduced-motion emulation |
| Accessibility | `@axe-core/playwright` | Gate: zero `serious`/`critical` on audited routes |
| Performance | Lighthouse CI; `EXPLAIN (ANALYZE)` assertions; k6 for load (staging) | Budgets from NFR-PERF |
| Visual regression | Playwright screenshots of the component gallery | 360 px and 1280 px |
| Palette and tokens | Repository scripts (F-13 UT-01…03) | Hue window, literals, contrast |
| Static analysis | ESLint (incl. import-boundary and forbidden-globals rules), TypeScript `strict` | Zero warnings |
| Security scans | `npm audit` (prod deps, high+), secret scanning, container image scan | CI gates |
| Infrastructure | `terraform fmt -check`, `terraform validate`, `tflint` ◊ | No apply in CI for PRs |

## 4. What each level must cover

### 4.1 API unit tests

Table-driven tests for every rule that the specs express as a table or a
state diagram:

- State machines: OTP challenge, session/refresh, verification, ride request,
  quote, booking (full from × to × actor matrix), subscription, ticket,
  campaign.
- Policies: *listed* gate, *may operate vehicle*, *vehicle operable*,
  request eligibility, review eligibility, deletion eligibility, phone
  disclosure, dispute trigger, entitlement evaluation.
- Calculators: fare estimate, booking fee, cancellation fee, distance/bearing
  rounding and grid snapping, rating aggregate, period arithmetic, invoice
  numbering, weighted ad ordering (seeded RNG).
- Guards and filters: permission resolver equals `ADMIN_ROLE_PERMISSIONS`;
  exception filter never leaks internals; log redaction.

### 4.2 API integration tests

One suite per feature (`IT-Fnn-*` in the specs) plus cross-cutting suites:

| Suite | Proves |
| --- | --- |
| Access matrix | Every route × {anonymous, customer, driver, each of five admin roles} returns the expected 2xx/401/403 class, generated from route metadata |
| Ownership | Every resource route returns `404` for a foreign ID |
| Idempotency | Replay, body mismatch, missing key, concurrent duplicates on all `(idem)` routes |
| Concurrency | 20 parallel accepts on one request → one booking; parallel transitions; parallel checkouts |
| Spatial | Inclusion/exclusion at radius boundaries with seeded coordinates; no coordinates in any discovery payload (schema walk); GiST plan asserted |
| Privacy payloads | Recursive scan of responses for phone-, coordinate- and document-number-shaped values where they must not appear |
| Audit coverage | Every admin mutation writes exactly one audit row; audit immutability at the database |
| Jobs | Each scheduled job with a controlled clock, including two-instance locking |
| Migrations | Empty database → latest; run twice; seed idempotent |
| Fault injection | Redis down (fail-closed auth, bounded fail-open reads); storage down |

### 4.3 Web unit tests

- Stores: loading/ready/error transitions, polling scheduler (visibility,
  offline, back-off), idempotency-key lifecycle.
- Core: auth interceptor single-flight refresh; problem-details mapping;
  config merge; consent store; analytics loader decision table and PII
  scanner; platform adapters for each permission/failure case.
- UI components: states and ARIA for each; validators against contract
  regexes; artwork lookup for every `VehicleIcon` / `PackageArtwork`.
- Navigation model from permissions equals the table in F-16 §3.1.

### 4.4 End-to-end journeys

| ID | Journey | In PR smoke |
| --- | --- | :-: |
| E2E-F18-01 | Fresh stack: customer signs in → searches → requests → driver quotes → customer accepts → driver completes → customer reviews | ✔ |
| E2E-F01-03 | Admin enrols TOTP and signs in | ✔ |
| E2E-F05-01 | Officer approves a pending partner; partner appears in search | ✔ |
| E2E-F14-01/02/03 | No Google requests when unconfigured / undecided / rejected; correct order after accept | ✔ |
| E2E-F13-01/02/04 | Viewport sweep, reduced motion, axe | ✔ (subset of routes) |
| E2E-F04-01 | Driver onboarding at 360 px | nightly |
| E2E-F07-02/03 | Location denied; offline during submit | nightly |
| E2E-F08-02 | Cancellation and phone removal | nightly |
| E2E-F16-01/02/03 | Role-shaped navigation; flag off; suspension | nightly |
| E2E-F17-02…06 | Offline shell, no queued writes, update prompt, geolocation states | nightly |
| E2E-F09, F10, F11, F12 | Review, package request, upgrade (test mode), sponsored ad | nightly |

Multi-actor journeys use separate browser contexts. Google origins are
**intercepted and stubbed** in every test — tests never call Google.

## 5. Environments

| Environment | Purpose | Data | Adapters |
| --- | --- | --- | --- |
| Local | Development and all automated levels | Seed + factories | SMS dev (code echoed), payments manual, storage local disk |
| CI | Gates on every push/PR | Fresh containers per run | Same as local |
| Staging | Deployed build, smoke e2e, load and DAST | Synthetic only — **never production data** | SMS dev or sandbox route; payments sandbox when available; S3 |
| Production | Post-deploy smoke (read-only + a synthetic account) | Real | Real adapters only (start-up guard) |

## 6. Test data

- **Seed** (FR-OPS-015): regions, categories, places, plans, packages,
  default settings, first `super_admin` — the same seed serves development
  and tests.
- **Factories** build users, partners (with documents in any state),
  vehicles, requests, quotes and bookings directly through repositories for
  integration tests, and through the API for e2e setup.
- **Coordinates** come from a fixed fixture set around Gokarna with known
  pairwise distances (boundary cases at exactly the radius ± 10 m).
- **Clock**: a `Clock` port; tests advance time for expiry, renewal,
  retention and review-window cases.
- **Personal data**: synthetic only; phone numbers from a reserved test
  range; no real documents — fixture files are generated placeholders.
- **Isolation**: every test creates what it needs; no test depends on
  another's leftovers; parallel workers use separate schemas and Redis
  prefixes.

## 7. Quality gates

A pull request cannot merge unless all of these pass:

| Gate | Threshold |
| --- | --- |
| Contracts build | success (CJS + ESM + types) |
| Lint + type-check (api, web) | zero errors, zero warnings |
| API unit + integration | 100 % pass |
| Coverage | ≥ 80 % lines in API `domain` + `application`; ≥ 70 % API overall; ≥ 60 % web `core` + stores (NFR-MAINT-002) |
| OpenAPI drift | exported document equals `specs/api/openapi.yaml` |
| Access declarations | zero routes without one |
| Web unit | 100 % pass |
| Web build | success within bundle budgets (NFR-PERF-004) |
| Palette / literal / contrast checks | pass (F-13) |
| E2E smoke | 100 % pass |
| axe | zero serious/critical |
| Dependency audit | no high/critical in production dependencies |
| Secret scan | clean |
| Terraform | `fmt`, `validate` pass |
| Traceability | every requirement ID touched by the change has its matrix row updated (review checklist) |

Nightly: full e2e, visual regression, Lighthouse CI on `/`, `/explore`,
`/requests/:id`, container image scan. Before each release: load test at R1
capacity on staging, restore drill (quarterly), security review checklist.

Flaky tests are quarantined within one working day with an owner and a
ticket; a quarantined test does not count toward a requirement's status.

## 8. Accessibility and performance testing

**Accessibility (NFR-A11Y)**

| Method | Coverage |
| --- | --- |
| Automated axe in e2e | Landing, explore, driver profile, sign-in, request form, request detail, booking detail, partner dashboard and onboarding, admin queue and settings, consent banner, dialogs open |
| Keyboard-only e2e | Sign-in, request creation, quote acceptance, cancel dialog |
| Component unit tests | Roles, names, states, focus management |
| Emulation | Reduced motion; 200 % and 400 % zoom; forced colours ◊ |
| Manual, per release | Screen-reader pass (TalkBack + Chrome, VoiceOver + Safari) of the booking journey; checklist kept with the release record |

**Performance (NFR-PERF)**

| Method | Checks |
| --- | --- |
| Bundle budgets | Build fails over budget |
| Lighthouse CI (throttled) | LCP, CLS, TBT as INP proxy on audited routes |
| Trace-based e2e | No long task > 50 ms from scroll-linked effects |
| Query plans | Nearby search uses GiST; accept holds the row lock briefly |
| Load (k6, staging) | 50 req/s mixed profile incl. polling; p95/p99 per route; error rate |
| Field | Web Vitals through GA4 once enabled |

## 9. Security testing

- Negative authorisation and validation tests in every feature suite.
- Privacy payload scans (§4.2).
- Start-up guard tests for development adapters.
- Dependency, secret and image scans in CI.
- DAST baseline scan against staging before release ◊.
- Independent penetration test before public launch (NFR-SEC-012).

## 10. What is not automated yet

Stated plainly so nobody assumes otherwise:

| Area | State |
| --- | --- |
| Real SMS delivery, DLT templates | Not testable until a provider exists (R1.1) |
| Real payment flows, webhooks, refunds | Not testable until a gateway exists (R1.1) |
| Native builds (Capacitor), push, background location | Not built (R2) |
| Cross-browser matrix | Chromium is automated; Safari/WebKit and Firefox are manual until added as Playwright projects |
| Real devices on real 4G | Manual check before launch |
| Screen readers | Manual per release |
| Load and soak | Needs a deployed staging environment |
| Terraform apply / infrastructure tests | Validate/plan only; no cloud account in R1 |
| Disaster recovery (PITR restore) | Manual drill once infrastructure exists |
| Kannada / Hindi rendering | Pseudo-locale only until translations exist |
| Fraud heuristics (reviews, ads) | Rules unit-tested; no adversarial test set |
| Legal/compliance conformance | Cannot be automated; needs counsel (D-03, D-04, D-10) |
