# Payana — Traceability Matrix

*Version 1.0 · 2026-11-10 · 208 functional + 62 non-functional requirements*

> ## Read this first
>
> **Every status below is `planned`.** This matrix was written with the
> specifications, before and alongside the code, by the specification work
> stream. It records what is *intended* to implement and test each
> requirement. It does **not** claim that anything has been built or that any
> test exists or passes.
>
> At the end of the build the parent work stream **reconciles every row
> against the actual code and actual test results** and sets each status to
> one of:
>
> | Status | Meaning |
> | --- | --- |
> | `built` | Implemented; its listed automated tests exist and pass |
> | `partial` | Implemented in part, or implemented without all listed tests — the gap is stated in Notes |
> | `stubbed` | Present behind a development adapter or placeholder (SMS, payments, push) — stated in Notes |
> | `planned` | Not implemented yet |
> | `withdrawn` | Removed by a recorded decision (row kept) |
>
> Until that reconciliation is done, treat this file as a plan. Locations and
> test IDs are *planned* locations; the reconciliation replaces them with
> real file paths where they differ.

## Legend

**API operations** are `METHOD path` relative to `/api/v1`, taken from
`packages/contracts/src/routes.ts`. "—" means no API operation (client-only,
job, or cross-cutting). "**gap**" means the contract has no operation for
the requirement (`functional-requirements.md` §22).

**Planned implementation**

| Shorthand | Path |
| --- | --- |
| `api:<module>` | `apps/api/src/modules/<module>/` (`domain`, `application`, `infrastructure`, `presentation`) |
| `api:boot` | `apps/api/src/` bootstrap, global pipeline |
| `web:core/<x>` | `apps/web/src/app/core/<x>/` |
| `web:ui` | `apps/web/src/app/ui/` and `apps/web/src/styles/` |
| `web:<feature>` | `apps/web/src/app/features/<feature>/` |
| `contracts` | `packages/contracts/src/` |
| `infra` | `docker-compose.yml`, `infra/terraform/`, `.github/workflows/` |

**Planned tests** use the IDs defined in each feature spec §9
(`UT` unit · `IT` API integration · `E2E` browser · `NT` negative).
Planned locations: API unit `apps/api/src/modules/**/**.spec.ts`; API
integration `apps/api/test/*.e2e-spec.ts`; web unit
`apps/web/src/app/**/*.spec.ts`; browser `apps/web/e2e/*.spec.ts`.

## 1. Identity and access — F-01

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-IAM-001 | `POST /auth/otp/request` | `api:identity`; `web:auth` | UT-F01-01, -02; IT-F01-01; E2E-F01-01 | planned | |
| FR-IAM-002 | `POST /auth/otp/verify` | `api:identity`; `web:auth`, `web:core/auth` | IT-F01-01; E2E-F01-01 | planned | |
| FR-IAM-003 | `POST /auth/otp/request`, `/auth/otp/verify` | `api:identity`, `api:platform` (rate limit) | UT-F01-02; IT-F01-04; NT-F01-02 | planned | |
| FR-IAM-004 | `POST /auth/otp/verify`, `POST /auth/refresh` | `api:identity`; `web:core/auth` | IT-F01-02; UT-F01-06; NT-F17-01 | planned | |
| FR-IAM-005 | `POST /auth/refresh` | `api:identity` | UT-F01-03; IT-F01-03 | planned | |
| FR-IAM-006 | `POST /auth/logout` | `api:identity`; `web:core/auth` | IT-F01-03; E2E-F01-02 | planned | |
| FR-IAM-007 | `GET /auth/sessions`; `DELETE /auth/sessions/{sessionId}` | `api:identity`; `web:account` | IT-F01-03 | planned | |
| FR-IAM-008 | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/admin/login` | `api:identity`, `api:platform` | IT-F01-04, -05 | planned | |
| FR-IAM-009 | `POST /auth/otp/verify` | `api:identity` | IT-F01-01 | planned | |
| FR-IAM-010 | every protected operation | `api:boot` global guard; ownership checks in each `application` layer | IT-F01-06; ownership suite; NT per feature | planned | |
| FR-IAM-011 | `POST /auth/admin/login` | `api:identity`; `web:admin` | IT-F01-05; E2E-F01-03 | planned | No change-password operation (gap) |
| FR-IAM-012 | `POST /auth/admin/login`, `POST /auth/admin/mfa/verify` | `api:identity`; `web:admin` | UT-F01-05; IT-F01-05; E2E-F01-03 | planned | |
| FR-IAM-013 | all `/admin/*` | `contracts` (`ADMIN_ROLE_PERMISSIONS`); `api:identity` permission resolver | UT-F01-04; IT-F16-01 | planned | |
| FR-IAM-014 | all auth and protected operations | `api:identity` | NT-F01-05; IT-F16-03 | planned | |
| FR-IAM-015 | **gap** | support process | — | planned | P2; no contract operation |
| FR-IAM-016 | `PATCH /me` (attribute only); **gap** (sign-in, linking) | `api:identity` | IT-F02-01 | planned | Email sign-in/linking P2 |
| FR-IAM-017 | side effect of auth operations; read via `GET /admin/audit-logs` | `api:identity` → `api:platform` audit | IT-F01-03, -04, -05; IT-F16-05 | planned | |

## 2. Customer account and privacy — F-02

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-ACC-001 | `GET /me`; `PATCH /me` | `api:identity`; `web:account` | IT-F02-01; E2E-F02-01 | planned | |
| FR-ACC-002 | `GET`, `POST /me/saved-places`; `PUT`, `DELETE /me/saved-places/{placeId}` | `api:identity`; `web:account` | UT-F02-01; IT-F02-02; E2E-F02-01 | planned | |
| FR-ACC-003 | `GET`, `PUT`, `DELETE /me/emergency-contact` | `api:identity`; `web:account` | IT-F02-03 | planned | |
| FR-ACC-004 | `GET`, `PUT /me/consents` | `api:identity`; `web:account`, `web:core/analytics` | IT-F02-04; E2E-F02-02 | planned | |
| FR-ACC-005 | `GET`, `POST`, `DELETE /me/deletion-request` | `api:identity`; `web:account` | UT-F02-02; IT-F02-05 | planned | |
| FR-ACC-006 | — (job `account-erasure`) | `api:identity` job | UT-F02-03; IT-F02-05 | planned | |
| FR-ACC-007 | `PATCH /me` | `api:identity`; `web:core` (locale) | IT-F02-01 | planned | English only at R1 |
| FR-ACC-008 | `POST /me/deletion-request` | `api:identity` (calls `bookings` service) | UT-F02-02; IT-F02-05 | planned | |

## 3. Catalogue — F-03

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-CAT-001 | `GET /regions` | `api:catalog`; `web:core/api`, `web:core/config` | UT-F03-01; IT-F03-01; E2E-F03-01 | planned | |
| FR-CAT-002 | `GET /vehicle-categories` | `api:catalog`; `web:core/api` | UT-F03-03; IT-F03-01 | planned | |
| FR-CAT-003 | `GET /fare-estimate` | `api:catalog`; `web:booking` | UT-F03-02; IT-F03-01; NT-F03-02 | planned | `basis: straight_line` |
| FR-CAT-004 | `GET`, `POST /admin/regions`; `PUT /admin/regions/{regionId}` | `api:catalog` (admin presentation); `web:admin` | IT-F03-04; NT-F03-01 | planned | |
| FR-CAT-005 | `GET`, `POST /admin/vehicle-categories`; `PUT /admin/vehicle-categories/{categoryId}` | `api:catalog`; `web:admin` | IT-F03-05; NT-F03-01 | planned | |
| FR-CAT-006 | `PUT /admin/regions/{regionId}` (data only) | `api:catalog`; seed | IT-F03-04; release-plan §9 rehearsal | planned | |
| FR-CAT-007 | `GET /public/config` | `api:platform` (settings); `web:core/config` | IT-F03-03; UT-F14-01 | planned | |
| FR-CAT-008 | `GET /places` | `api:catalog`; `web:core/api`, `web:ui` (LocationPicker) | IT-F03-02; UT-F07-06; E2E-F07-01 | planned | |
| FR-CAT-009 | **gap** (no admin operation) | `api:catalog` seed / migration | IT-F18-08 (seed) | planned | Seed data at R1; admin operations missing from the contract |

## 4. Partner onboarding — F-04

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-PRT-001 | `GET`, `PUT /driver/profile` | `api:marketplace`; `web:partner` | UT-F04-01; IT-F04-01; E2E-F04-01 | planned | |
| FR-PRT-002 | `GET`, `POST /driver/vehicles`; `PUT`, `DELETE /driver/vehicles/{vehicleId}` | `api:marketplace`; `web:partner` | UT-F04-05; IT-F04-01; NT-F04-01 | planned | |
| FR-PRT-003 | `GET`, `POST /driver/documents` | `api:marketplace`; `web:partner` | IT-F04-01, -02 | planned | |
| FR-PRT-004 | `POST /uploads/presign`; `PUT /uploads/local/{token}`; `GET /files/{token}` | `api:platform` storage port; `api:marketplace`; `web:partner` | IT-F04-02; NT-F04-02 | planned | Local-disk adapter in development |
| FR-PRT-005 | `POST /driver/profile/submit` | `api:marketplace`; `web:partner` | UT-F04-01; IT-F04-01 | planned | |
| FR-PRT-006 | `PUT /driver/availability` | `api:marketplace`; `web:partner` | UT-F04-02, -03; IT-F04-03; E2E-F04-02 | planned | |
| FR-PRT-007 | `PUT /driver/profile` (`operatingHours`) | `api:marketplace`; `web:partner` | IT-F04-01 | planned | |
| FR-PRT-008 | `POST /driver/location` | `api:marketplace`; `web:partner`, `web:core/platform` | UT-F04-06; IT-F04-04; NT-F04-04 | planned | Foreground only in the PWA |
| FR-PRT-009 | `PUT /driver/rates` | `api:marketplace`; `web:partner` | UT-F04-04; IT-F04-01 | planned | |
| FR-PRT-010 | `GET`, `POST /driver/authorizations`; `POST /driver/authorizations/{authId}/accept`; `POST …/revoke` | `api:marketplace`; `web:partner` | UT-F04-02; IT-F04-05 | planned | |
| FR-PRT-011 | `PUT /driver/availability`; `POST /driver/requests/{requestId}/quotes` | `api:marketplace` policy, used by `api:bookings` | UT-F04-02, -03; IT-F04-03; IT-F07-06 | planned | |
| FR-PRT-012 | `POST /driver/vehicles` | `api:marketplace` + `api:commerce` entitlements | UT-F11-01; IT-F04-01; IT-F11-04 | planned | |
| FR-PRT-013 | `GET /driver/metrics` | `api:marketplace`; `web:partner` | IT-F04-06 | planned | |
| FR-PRT-014 | `GET /driver/bookings`; `GET /driver/metrics` | `api:bookings`, `api:marketplace`; `web:partner` | IT-F08-03; IT-F04-06 | planned | |
| FR-PRT-015 | `GET /bookings/{bookingId}` | `api:bookings` serializer | UT-F08-05; IT-F08-02 | planned | |
| FR-PRT-016 | `PUT /driver/profile`; `GET /drivers` | `api:marketplace` | IT-F04-01; IT-F06-05 | planned | |
| FR-PRT-017 | `PUT /driver/profile` and onboarding operations | `api:marketplace` | — | planned | P2 |

## 5. Verification — F-05

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-VER-001 | `GET /admin/verifications` | `api:marketplace` + `api:admin`; `web:admin` | IT-F05-01; NT-F05-01 | planned | |
| FR-VER-002 | `GET /admin/verifications/{driverProfileId}` | `api:marketplace`, storage port; `web:admin` | IT-F05-02 | planned | |
| FR-VER-003 | `POST /admin/documents/{documentId}/review` | `api:marketplace`; `web:admin` | IT-F05-03; E2E-F05-02 | planned | |
| FR-VER-004 | `POST /admin/verifications/{driverProfileId}/decision` | `api:marketplace`; `web:admin` | UT-F05-01, -02; IT-F05-04; E2E-F05-01 | planned | |
| FR-VER-005 | — (job `document-expiry`) | `api:marketplace` job | UT-F05-04; IT-F05-05 | planned | |
| FR-VER-006 | `PUT /driver/vehicles/{vehicleId}`; `POST /driver/documents` | `api:marketplace` | IT-F05-06 | planned | |
| FR-VER-007 | `POST /admin/vehicles/{vehicleId}/listing` | `api:marketplace`; `web:admin` | IT-F05-07 | planned | |
| FR-VER-008 | side effect of review and decision operations | `api:marketplace` → audit, outbox | IT-F05-03, -04; IT-F16-06 | planned | |
| FR-VER-009 | `GET /drivers`; `GET /driver/requests`; `POST /driver/requests/{requestId}/quotes` | `api:marketplace` *listed* gate | UT-F05-03; NT-F05-03 | planned | |

## 6. Discovery — F-06

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-DSC-001 | `GET /drivers` | `api:marketplace` (PostGIS repository); `web:explore` | IT-F06-01, -07; E2E-F06-01 | planned | |
| FR-DSC-002 | `GET /drivers` | `api:marketplace`; `web:explore` | IT-F06-04 | planned | |
| FR-DSC-003 | `GET /drivers` | `api:marketplace` | UT-F06-03; IT-F06-04 | planned | |
| FR-DSC-004 | `GET /drivers` | `api:marketplace`; `web:explore` | IT-F06-04; E2E-F06-01 | planned | |
| FR-DSC-005 | `GET /drivers`; `GET /drivers/{driverId}` | `api:marketplace` mapper | UT-F06-01, -02; IT-F06-02, -03 | planned | |
| FR-DSC-006 | `GET /drivers/{driverId}` | `api:marketplace`; `web:explore` | IT-F06-06; NT-F06-02 | planned | |
| FR-DSC-007 | `GET /drivers` | `api:marketplace` + `api:commerce` | UT-F06-03; IT-F06-04; IT-F11-06 | planned | |
| FR-DSC-008 | `GET /drivers` | `api:marketplace` | IT-F06-04 | planned | |
| FR-DSC-009 | `GET /drivers` (`regionSlug`, no point) | `api:marketplace`; `web:explore` | IT-F06-05; E2E-F06-02 | planned | |
| FR-DSC-010 | — (client carries context to `POST /ride-requests`) | `web:explore` → `web:booking` | E2E-F06-01 | planned | No search fields in the contract |

## 7. Ride requests and quotations — F-07

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-REQ-001 | `POST /ride-requests` | `api:bookings`; `web:booking` | UT-F07-01; IT-F07-01, -02; E2E-F07-01 | planned | |
| FR-REQ-002 | `POST /ride-requests` | `api:bookings`; `web:booking` | UT-F07-01, -02; IT-F07-01; NT-F07-02 | planned | |
| FR-REQ-003 | `POST /ride-requests` | `api:bookings`; `web:booking` | UT-F07-01; IT-F07-01 | planned | |
| FR-REQ-004 | `POST /ride-requests` | `api:bookings` + `api:commerce`; `web:packages`, `web:booking` | IT-F07-01; IT-F10-02; E2E-F10-01 | planned | |
| FR-REQ-005 | `POST /ride-requests` (`targetDriverId`) | `api:bookings`; `web:explore`, `web:booking` | IT-F07-01 | planned | |
| FR-REQ-006 | `POST /ride-requests` | `api:bookings` (eligibility via `marketplace`) | UT-F07-03; IT-F07-01 | planned | |
| FR-REQ-007 | — (job `request-expiry`); `GET /ride-requests/{requestId}` | `api:bookings` job | UT-F07-02; IT-F07-04 | planned | |
| FR-REQ-008 | `POST /ride-requests` | `api:bookings` | IT-F07-03 | planned | |
| FR-REQ-009 | `GET /driver/requests`; `GET /driver/requests/{requestId}` | `api:bookings`; `web:partner` | IT-F07-05; NT-F07-01 | planned | |
| FR-REQ-010 | `POST /driver/requests/{requestId}/quotes` | `api:bookings`; `web:partner` | UT-F07-04; IT-F07-06; E2E-F07-01 | planned | |
| FR-REQ-011 | `POST /driver/requests/{requestId}/quotes` | `api:bookings` (+ `marketplace`, `commerce` policies) | UT-F07-04; IT-F07-06; NT-F07-03 | planned | |
| FR-REQ-012 | `POST /driver/quotes/{quoteId}/withdraw` | `api:bookings`; `web:partner` | UT-F07-05; IT-F07-06 | planned | |
| FR-REQ-013 | `POST /driver/requests/{requestId}/decline` | `api:bookings`; `web:partner` | IT-F07-06 | planned | |
| FR-REQ-014 | `GET /ride-requests/{requestId}`; `GET /ride-requests` | `api:bookings`; `web:booking` | IT-F07-07; E2E-F07-01 | planned | Polling |
| FR-REQ-015 | `POST /ride-requests/{requestId}/quotes/{quoteId}/accept` | `api:bookings` (row lock, idempotency) | IT-F07-07, -08; E2E-F07-01 | planned | |
| FR-REQ-016 | `POST /ride-requests/{requestId}/cancel` | `api:bookings`; `web:booking` | IT-F07-04 | planned | |
| FR-REQ-017 | `POST /ride-requests` | `api:bookings` (+ `catalog` estimate) | IT-F07-01 | planned | |
| FR-REQ-018 | — (job `quote-expiry`); accept operation | `api:bookings` | UT-F07-04, -05; IT-F07-08 | planned | |
| FR-REQ-019 | `GET /places`; `GET /me/saved-places` | `web:ui` LocationPicker, `web:core/platform` geolocation; `api:catalog` | UT-F07-06; E2E-F07-01, -02 | planned | |

## 8. Bookings — F-08

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-BKG-001 | created by accept; `GET /bookings/{bookingId}` | `api:bookings` | UT-F08-06; IT-F08-01 | planned | |
| FR-BKG-002 | `GET /bookings` | `api:bookings`; `web:booking` | IT-F08-03 | planned | |
| FR-BKG-003 | `GET /bookings/{bookingId}` | `api:bookings`; `web:booking`, `web:partner` | IT-F08-01, -02; E2E-F08-01 | planned | |
| FR-BKG-004 | `POST /bookings/{bookingId}/transitions` | `api:bookings`; `web:partner` | UT-F08-01; IT-F08-04; E2E-F08-01 | planned | |
| FR-BKG-005 | `POST /bookings/{bookingId}/cancel` | `api:bookings`; `web:booking`, `web:partner` | UT-F08-04; IT-F08-05; E2E-F08-02 | planned | Late fee zero at R1 |
| FR-BKG-006 | `GET /bookings/{bookingId}` | `api:bookings` serializer | UT-F08-05; IT-F08-02 | planned | |
| FR-BKG-007 | `GET /bookings/{bookingId}/receipt` | `api:bookings`; `web:booking` | IT-F08-06 | planned | Not a tax invoice |
| FR-BKG-008 | `GET /driver/bookings` | `api:bookings`; `web:partner` | IT-F08-03 | planned | |
| FR-BKG-009 | `POST /bookings/{bookingId}/transitions` (`no_show`) | `api:bookings` | UT-F08-01; IT-F08-04 | planned | |
| FR-BKG-010 | `GET /bookings/{bookingId}` (`allowedActions`) | `api:bookings`; `web:booking` | UT-F08-02; IT-F08-01 | planned | |
| FR-BKG-011 | accept operation; `GET /public/config` | `api:bookings` + `api:commerce` fee settings | UT-F08-03; IT-F08-01; IT-F11-08 | planned | Disabled by default |
| FR-BKG-012 | `POST /support/tickets` (trigger, assumption A-17); `POST /admin/bookings/{bookingId}/resolve` | `api:engagement` → `api:bookings`; `web:admin` | UT-F09-05; IT-F09-05; IT-F08-07 | planned | No dedicated "dispute" operation (gap) |
| FR-BKG-013 | all booking mutations | `api:bookings` (`booking_events`) | IT-F08-04, -05 | planned | |
| FR-BKG-014 | **gap** | — | — | planned | P2; no contract operation |

## 9. Reviews and support — F-09

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-REV-001 | `POST /bookings/{bookingId}/review` | `api:engagement`; `web:booking` | UT-F09-01; IT-F09-01, -02; E2E-F09-01 | planned | |
| FR-REV-002 | `GET /drivers/{driverId}/reviews` | `api:engagement`; `web:explore` | IT-F09-01 | planned | |
| FR-REV-003 | `POST /driver/reviews/{reviewId}/reply` | `api:engagement`; `web:partner` | IT-F09-03 | planned | |
| FR-REV-004 | `POST /admin/reviews/{reviewId}/moderation` | `api:engagement`; `web:admin` | IT-F09-03; NT-F09-03 | planned | |
| FR-REV-005 | side effect of review and moderation | `api:engagement` → `marketplace` aggregate | UT-F09-03; IT-F09-01, -03 | planned | |
| FR-SUP-001 | `POST /support/tickets` | `api:engagement`; `web:account`, `web:booking` | UT-F09-04; IT-F09-04; E2E-F09-02 | planned | |
| FR-SUP-002 | `GET /support/tickets`; `GET /support/tickets/{ticketId}`; `POST /support/tickets/{ticketId}/messages` | `api:engagement`; `web:account` | IT-F09-04, -06 | planned | |
| FR-SUP-003 | `GET /admin/support/tickets`; `GET`, `PATCH /admin/support/tickets/{ticketId}`; `POST /admin/support/tickets/{ticketId}/messages` | `api:engagement`; `web:admin` | IT-F09-06; NT-F09-03 | planned | |
| FR-SUP-004 | `POST /support/tickets` | `api:engagement` | UT-F09-04; IT-F09-04 | planned | |
| FR-SUP-005 | `POST /support/tickets` (`refund_request`) | `api:engagement` | IT-F09-04 | planned | Refund execution P2 |
| FR-SUP-006 | `POST /support/tickets` (`abuse_report`) | `api:engagement` | IT-F09-04 | planned | Investigation tooling P2 |
| FR-SUP-007 | same as FR-SUP-001, -002 | `api:engagement`; `web:partner` | IT-F09-04, -06 | planned | |

## 10. Sightseeing packages — F-10

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-PKG-001 | `GET /packages` | `api:commerce`; `web:packages` | IT-F10-01 | planned | |
| FR-PKG-002 | `GET /packages/{slug}` | `api:commerce`; `web:packages` | IT-F10-01 | planned | |
| FR-PKG-003 | `POST /ride-requests` (`packageId`) | `web:packages` → `web:booking`; `api:bookings` | UT-F10-02; IT-F10-03; E2E-F10-01 | planned | |
| FR-PKG-004 | `GET`, `POST /admin/packages`; `PUT /admin/packages/{packageId}` | `api:commerce`; `web:admin` | UT-F10-01; IT-F10-04; NT-F10-01 | planned | |
| FR-PKG-005 | `PUT /admin/settings` (`features.packages`) | `api:platform` flags; `api:commerce`; `web:core/config` | IT-F10-02; E2E-F16-02 | planned | |

## 11. Subscriptions, featured listings, fees — F-11

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-SUB-001 | `GET /plans` | `api:commerce`; `web:partner`, `web:home` | IT-F11-01 | planned | |
| FR-SUB-002 | `GET /driver/subscription` | `api:commerce`; `web:partner` | IT-F11-01 | planned | |
| FR-SUB-003 | `POST /driver/subscription/checkout` | `api:commerce` + payment port; `web:partner` | UT-F11-06; IT-F11-02; E2E-F11-01 | planned | Manual adapter only — no money moves |
| FR-SUB-004 | `GET /driver/invoices` | `api:commerce`; `web:partner` | UT-F11-05; IT-F11-02 | planned | |
| FR-SUB-005 | `POST /driver/subscription/cancel` | `api:commerce`; `web:partner` | UT-F11-03; IT-F11-05 | planned | |
| FR-SUB-006 | enforced in `POST /driver/vehicles`, `POST /driver/requests/{requestId}/quotes`, `GET /drivers`, `GET /driver/metrics` | `api:commerce` entitlement service | UT-F11-01; IT-F11-04 | planned | |
| FR-SUB-007 | — (job `subscription-renewal`) | `api:commerce` job | UT-F11-02, -03; IT-F11-05 | planned | |
| FR-SUB-008 | `GET`, `POST /driver/featured-placements` | `api:commerce`; `web:partner` | UT-F11-04; IT-F11-06 | planned | |
| FR-SUB-009 | `GET`, `POST /admin/plans`; `PUT /admin/plans/{planId}` | `api:commerce`; `web:admin` | IT-F11-07; NT-F11-01 | planned | |
| FR-SUB-010 | `PUT /admin/settings` (`bookingFee`) | `api:platform` settings; `web:admin` | IT-F11-08 | planned | |
| FR-SUB-011 | **gap** | payment port (gateway adapter) | — | planned | P2 / R1.1 |
| FR-SUB-012 | **gap** | — | — | planned | P2 |
| FR-SUB-013 | **gap** | — | — | planned | P2 |

## 12. Local business advertisements — F-12

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-ADS-001 | `GET /ads` | `api:commerce`; `web:ui` AdSlot | UT-F12-01, -05; IT-F12-01; E2E-F12-01 | planned | |
| FR-ADS-002 | `POST /ads/{campaignId}/impression`; `POST /ads/{campaignId}/click` | `api:commerce`; `web:ui` AdSlot | IT-F12-03 | planned | |
| FR-ADS-003 | `GET`, `POST /admin/ad-campaigns`; `PUT /admin/ad-campaigns/{campaignId}` | `api:commerce`; `web:admin` | UT-F12-04; IT-F12-04; NT-F12-01, -02 | planned | |
| FR-ADS-004 | — (job `campaign-status`); `GET /ads` | `api:commerce` | UT-F12-03; IT-F12-04 | planned | |
| FR-ADS-005 | `GET /admin/ad-campaigns` (`stats`) | `api:commerce`; `web:admin` | IT-F12-03, -04 | planned | Totals only |
| FR-ADS-006 | `PUT /admin/settings` (`features.local_ads`); `GET /ads` | `api:platform` flags; `api:commerce` | IT-F12-01; E2E-F12-02 | planned | |
| FR-ADS-007 | `GET /ads` | `api:commerce` | UT-F12-02; IT-F12-02 | planned | |

## 13. Notifications — F-15

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-NTF-001 | `GET /notifications` | `api:engagement`; `web` shell | IT-F15-04; E2E-F15-01 | planned | |
| FR-NTF-002 | `POST /notifications/{notificationId}/read`; `POST /notifications/read-all` | `api:engagement`; `web` shell | IT-F15-04 | planned | |
| FR-NTF-003 | — (outbox) | `api:platform` outbox; `api:engagement` handlers | UT-F15-01, -03; IT-F15-01, -02, -03 | planned | |
| FR-NTF-004 | — | `api:platform` channel ports + development adapters | UT-F15-02; NT-F15-02 | planned | SMS / push / email are stubs at R1 |
| FR-NTF-005 | **gap** | — | — | planned | P2 |
| FR-NTF-006 | — | `api:engagement` consent gate | IT-F15-05 | planned | |
| FR-NTF-007 | polled: `GET /notifications`, `GET /ride-requests/{requestId}`, `GET /bookings/{bookingId}`, `GET /driver/requests` | `web` feature stores (polling scheduler) | UT-F15-04; E2E-F15-01 | planned | |

## 14. Admin console — F-16

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-ADM-001 | `GET /admin/overview` | `api:admin`; `web:admin` | IT-F16-02 | planned | |
| FR-ADM-002 | `GET /admin/users` | `api:admin`; `web:admin` | IT-F16-03 | planned | No single-user detail operation (gap) |
| FR-ADM-003 | `POST /admin/users/{userId}/suspend`; `POST /admin/users/{userId}/reinstate` | `api:admin` → `identity`, `marketplace`; `web:admin` | IT-F16-03; E2E-F16-03 | planned | |
| FR-ADM-004 | `GET /admin/bookings`; `GET /admin/bookings/{bookingId}` | `api:bookings` + `api:admin`; `web:admin` | IT-F08-07 | planned | |
| FR-ADM-005 | `POST /admin/bookings/{bookingId}/resolve` | `api:bookings`; `web:admin` | IT-F08-07 | planned | |
| FR-ADM-006 | `GET /admin/settings`; `PUT /admin/settings` | `api:platform` settings; `web:admin` | UT-F16-02; IT-F16-04; IT-F14-01, -02 | planned | |
| FR-ADM-007 | `GET /admin/audit-logs` | `api:platform` audit; `web:admin` | IT-F16-05 | planned | |
| FR-ADM-008 | `GET`, `POST /admin/staff`; `PATCH /admin/staff/{userId}` | `api:admin` → `identity`; `web:admin` | UT-F16-04; IT-F16-07; NT-F16-02 | planned | |
| FR-ADM-009 | all `/admin/*` | `api:boot` guard; `web:admin` navigation model | UT-F16-01; IT-F16-01; E2E-F16-01 | planned | |
| FR-ADM-010 | every admin mutation | `api:platform` audit service, called in each use case | UT-F16-03; IT-F16-06 | planned | |
| FR-ADM-011 | **gap** (`GET /health/ready` is the only health operation) | — | — | planned | P2 |
| FR-ADM-012 | `PUT /admin/settings` (`features`); `GET /public/config` | `api:platform`; `web:core/config` | IT-F16-04; E2E-F16-02 | planned | |

## 15. Design system and experience — F-13

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-UX-001 | — | `web:ui` (tokens) + palette check script | UT-F13-01, -02, -03; NT-F13-02 | planned | |
| FR-UX-002 | — | `web:ui` components | UT-F13-05; E2E-F13-07 | planned | |
| FR-UX-003 | — | `web:ui`, all features | E2E-F13-01; NT-F13-03 | planned | |
| FR-UX-004 | — | `web:ui` illustrations, icon sprite | UT-F13-07 | planned | |
| FR-UX-005 | — | `web:ui` motion directives; `web:home` | UT-F13-04; E2E-F13-03 | planned | |
| FR-UX-006 | — | `web:ui`; router view transitions | E2E-F13-03, -05 | planned | |
| FR-UX-007 | — | `web:ui` base styles + directives | UT-F13-04; E2E-F13-02 | planned | |
| FR-UX-008 | — | `web:ui` Skeleton, EmptyState, ErrorState, OfflineBanner | UT-F13-05; E2E-F17-02 | planned | |
| FR-UX-009 | — | `web:ui` validators and field components | UT-F13-06; E2E-F13-05 | planned | |
| FR-UX-010 | reads `GET /regions`, `/vehicle-categories`, `/drivers`, `/packages`, `/plans`, `/ads` | `web:home` | E2E-F13-03, -06 | planned | |
| FR-UX-011 | reads `GET /drivers` | `web:ui` Radar; `web:explore` | UT-F06-04 | planned | |
| FR-UX-012 | — | `web:legal` | E2E (route presence) | planned | Draft text pending legal review |

## 16. Analytics and ads settings — F-14

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-ANL-001 | `GET /public/config`; `PUT /admin/settings` | `web:core/analytics` loader; `api:platform` | UT-F14-02; E2E-F14-03 | planned | Identifier empty until the owner supplies it |
| FR-ANL-002 | `GET /public/config`; `PUT /admin/settings` | `web:core/analytics` | UT-F14-06; E2E-F14-04, -06 | planned | Labels empty until supplied |
| FR-ANL-003 | `GET /public/config`; `PUT /admin/settings` | `web:core/analytics`, `web:ui` AdSlot | E2E-F14-08 | planned | Optional (D-07) |
| FR-ANL-004 | — | `web:core/analytics` | UT-F14-02; E2E-F14-01 | planned | |
| FR-ANL-005 | — | `web:core/analytics` consent store + banner | UT-F14-03, -08; E2E-F14-02, -03, -09 | planned | |
| FR-ANL-006 | — | `web:core/analytics` router listener | UT-F14-04; E2E-F14-05 | planned | |
| FR-ANL-007 | — | `web:core/analytics` event catalogue; calls in features | UT-F14-05; E2E-F14-06 | planned | |
| FR-ANL-008 | — | `web:core/analytics` sanitiser | UT-F14-04, -05 | planned | |
| FR-ANL-009 | `PUT /admin/settings` | `web:admin` settings form; `api:platform` validation | UT-F14-07; IT-F14-01; NT-F14-02 | planned | |
| FR-ANL-010 | `GET /public/config` (fallback: static file) | `web:core/config` | UT-F14-01 | planned | |
| FR-ANL-011 | `GET`, `PUT /me/consents` | `web:core/analytics`; `api:identity` | UT-F14-08; E2E-F02-02 | planned | |
| FR-ANL-012 | — | `infra` (web hosting) | — | planned | P2; no mechanism defined |

## 17. PWA, offline and mobile readiness — F-17

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-PWA-001 | — | `apps/web` manifest + service worker config | E2E-F17-01 | planned | |
| FR-PWA-002 | cached: `GET /regions`, `/vehicle-categories`, `/places`, `/plans`, `/packages` | service worker config; `web:ui` OfflineBanner | UT-F17-05; E2E-F17-02 | planned | |
| FR-PWA-003 | — | `web:core/api` (no offline queue), feature stores | UT-F17-03; E2E-F17-03 | planned | |
| FR-PWA-004 | — | `web` shell update prompt | E2E-F17-05 | planned | |
| FR-PWA-005 | — | `web:core/platform` ports + web adapters; lint rule | UT-F17-01, -04 | planned | |
| FR-PWA-006 | — | Capacitor project (not created) | — | planned | P2 |
| FR-PWA-007 | `POST /auth/refresh` with `X-Client-Platform: native` (server side only) | native adapters (not created) | — | planned | P2; server support for native token transport is part of FR-IAM-004 |
| FR-PWA-008 | — | product copy in `web:partner`; ADR-0007 | E2E (copy presence) | planned | |
| FR-PWA-009 | — | `web:core/platform` geolocation adapter | UT-F17-01; E2E-F17-06 | planned | |

## 18. Platform operations — F-18

| ID | API operation(s) | Planned implementation | Planned tests | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| FR-OPS-001 | `GET /health/live`; `GET /health/ready` | `api:platform` health | IT-F18-01 | planned | |
| FR-OPS-002 | all | `api:boot` logging + request ID | UT-F18-05; IT-F18-02 | planned | |
| FR-OPS-003 | all | `api:boot` exception filter; `web:core/api` mapping | UT-F18-01; IT-F18-03 | planned | |
| FR-OPS-004 | all | `api:boot` validation pipe; DTOs in each `presentation` | UT-F18-02; NT-F18-01; NT per feature | planned | |
| FR-OPS-005 | all (document) | `api:boot` OpenAPI setup; export script; `specs/api/openapi.yaml` | IT-F18-09 | planned | |
| FR-OPS-006 | — | `apps/api` migrations | IT-F18-08 | planned | |
| FR-OPS-007 | all `(idem)` operations | `api:platform` idempotency interceptor + store | UT-F18-03; IT-F18-04; IT-F07-02 | planned | |
| FR-OPS-008 | — | `api:platform` outbox, scheduler, locks; jobs in owning modules | IT-F18-06; IT-F15-01…03 | planned | In-process workers |
| FR-OPS-009 | — | `docker-compose.yml` | manual: AC-F18-13 | planned | |
| FR-OPS-010 | — | `.github/workflows` | pipeline run | planned | |
| FR-OPS-011 | — | `infra/terraform` | NT-F18-02 (`validate`) | planned | Defined, not applied |
| FR-OPS-012 | — | `api:boot` config schema; `.env.example` | UT-F18-04 | planned | |
| FR-OPS-013 | — | `api:platform` metrics; tracing hooks | AC-F18-18 check | planned | P1; backend undecided |
| FR-OPS-014 | all rate-limited operations | `api:platform` rate limiter (Redis) | IT-F18-05; IT-F01-04 | planned | |
| FR-OPS-015 | — | `apps/api` seed | IT-F18-08 | planned | Seed values illustrative |
| FR-OPS-016 | — | `api:platform` audit service | IT-F18-07; IT-F16-05, -06 | planned | |

## 19. Non-functional requirements

| ID | Feature(s) | Planned implementation | Planned verification | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| NFR-PERF-001 | F-18, all | API design; indexes | k6 load test on staging | planned | Needs a deployed environment |
| NFR-PERF-002 | F-06 | `api:marketplace` PostGIS query + GiST | IT-F06-07 | planned | |
| NFR-PERF-003 | F-13 | `apps/web` | E2E-F13-06 (Lighthouse CI) | planned | |
| NFR-PERF-004 | F-13, F-16 | `apps/web/angular.json` budgets; lazy admin | web build gate | planned | |
| NFR-PERF-005 | F-13 | `web:ui` motion | review rule; trace-based e2e | planned | |
| NFR-PERF-006 | F-07 | `api:bookings` accept use case | IT-F07-07 timing | planned | |
| NFR-PERF-007 | F-03, F-14 | `api:catalog`, `api:platform` cache headers | IT-F03-01, -03 | planned | |
| NFR-SEC-001 | F-18 | `infra/terraform` (ALB, CloudFront) | infrastructure check | planned | Not applied |
| NFR-SEC-002 | F-01, F-18 | `api:boot` default-deny guard | IT-F01-06; IT-F18-09 | planned | |
| NFR-SEC-003 | F-18 | `.gitignore`, secret store, CI scan | secret-scan gate | planned | |
| NFR-SEC-004 | F-01 | `api:identity` hashing and encryption | UT-F01-01, -03, -05 | planned | |
| NFR-SEC-005 | F-18, F-14 | `api:boot` headers; CDN response-headers policy | header test | planned | |
| NFR-SEC-006 | F-18 | validation pipe + DTOs | NT per feature | planned | |
| NFR-SEC-007 | F-01, F-18 | `api:platform` rate limiter | IT-F18-05; IT-F01-04; IT-F12-03 | planned | Values are defaults |
| NFR-SEC-008 | F-04, F-05 | storage port; bucket policy | IT-F04-02; IT-F05-02 | planned | Malware scan not in R1 |
| NFR-SEC-009 | F-18 | lockfiles; CI audit | audit gate | planned | |
| NFR-SEC-010 | F-16, F-18 | DB role privileges on `audit_logs` | IT-F16-05; IT-F18-07 | planned | |
| NFR-SEC-011 | F-01 | `api:identity` cookie + origin checks; CORS | NT-F01-04 | planned | |
| NFR-SEC-012 | — | external | penetration test report | planned | R1.1 blocker |
| NFR-PRIV-001 | all | `specs/architecture/data-model.md` classification | review at each migration | planned | |
| NFR-PRIV-002 | F-04, F-06 | `driver_locations` upsert; no search-point storage | IT-F04-04 | planned | |
| NFR-PRIV-003 | F-18, F-02 | `retention-purge`, `account-erasure` jobs | job tests | planned | Periods pending legal review |
| NFR-PRIV-004 | F-14 | `web:core/analytics` | E2E-F14-01, -02 | planned | |
| NFR-PRIV-005 | F-18, F-14 | log redaction; analytics sanitiser | UT-F18-05; UT-F14-05 | planned | |
| NFR-PRIV-006 | F-02 | `account-erasure` job | IT-F02-05 | planned | |
| NFR-PRIV-007 | F-18 | `infra/terraform` region variable | plan review | planned | Not applied |
| NFR-A11Y-001 | F-13, all web | `web:ui` | E2E-F13-04; manual audit | planned | |
| NFR-A11Y-002 | F-13 | `web:ui` focus management | E2E-F13-05 | planned | |
| NFR-A11Y-003 | F-13 | tokens | UT-F13-03 | planned | |
| NFR-A11Y-004 | F-13 | base styles, directives | E2E-F13-02 | planned | |
| NFR-A11Y-005 | F-13 | tokens, components | E2E-F13-01 | planned | |
| NFR-A11Y-006 | F-13, F-18 | CI gate | E2E-F13-04 | planned | |
| NFR-REL-001 | F-18 | infrastructure; SLO dashboard | uptime monitoring | planned | Needs production |
| NFR-REL-002 | F-18 | RDS PITR | restore drill | planned | Needs production |
| NFR-REL-003 | F-18, F-07, F-11 | idempotency interceptor | IT-F18-04; IT-F07-02; IT-F11-02 | planned | |
| NFR-REL-004 | F-18 | degradation rules in guards and limiter | fault-injection integration tests | planned | |
| NFR-REL-005 | F-15 | outbox worker | IT-F15-02, -03 | planned | |
| NFR-REL-006 | F-18 | migration discipline; pipeline | pipeline check | planned | |
| NFR-OBS-001 | F-18 | `api:boot` logger | IT-F18-02 | planned | |
| NFR-OBS-002 | F-18 | `api:platform` metrics | AC-F18-18 check | planned | |
| NFR-OBS-003 | F-18 | OpenTelemetry instrumentation | staging trace | planned | P1 |
| NFR-OBS-004 | F-18 | `infra/terraform` alarms | plan review | planned | Not applied |
| NFR-OBS-005 | F-14 | `web:core/analytics` (`web_vitals`, `exception`) | UT-F14-05 | planned | Depends on GA4 being enabled |
| NFR-SCAL-001 | F-18 | stateless API; job locks | IT-F18-05, -06 | planned | |
| NFR-SCAL-002 | F-18 | sizing; indexes | load test | planned | Needs staging |
| NFR-SCAL-003 | F-03 | regions as data | IT-F03-04; runbook rehearsal | planned | |
| NFR-SCAL-004 | F-18 | import-boundary lint; module exports | lint gate; architecture test | planned | |
| NFR-MAINT-001 | F-18 | tsconfig `strict`; ESLint | CI | planned | |
| NFR-MAINT-002 | F-18 | coverage configuration | coverage gate | planned | |
| NFR-MAINT-003 | F-18 | lockfiles; exact versions | `npm ci` in CI | planned | |
| NFR-MAINT-004 | all | `specs/architecture/adr/` | review | planned | 17 ADRs written |
| NFR-MAINT-005 | F-18 | export script; CI | IT-F18-09 | planned | |
| NFR-I18N-001 | F-13 | string catalogue | lint; pseudo-locale run | planned | English only at R1 |
| NFR-I18N-002 | F-13 | formatters | UT-F13-06 | planned | |
| NFR-I18N-003 | F-13 | font stacks; layouts | visual check | planned | |
| NFR-I18N-004 | F-03, F-18 | UTF-8; label search | IT-F03-02 | planned | |
| NFR-COMP-001 | F-02, F-14 | consent, erasure, notices | counsel sign-off | planned | Legal review required (D-03) |
| NFR-COMP-002 | F-01 | SMS gateway adapter | provider onboarding | planned | R1.1 (D-02) |
| NFR-COMP-003 | F-11 | invoice fields | adviser sign-off | planned | Contract has no tax fields (D-10) |
| NFR-COMP-004 | — | `specs/product-requirements.md` §3, §8 | counsel review | planned | D-04 |
| NFR-COMP-005 | F-14 | consent mode; no PII; AdSense rules | F-14 acceptance tests; checklist | planned | |
| NFR-COMP-006 | F-06, F-12 | labels in `web:ui` | UT-F12-05; E2E-F12-01 | planned | |

## 20. Reconciliation checklist (for the end of the build)

1. For each row, locate the real implementation; replace the planned
   location if it differs.
2. For each planned test ID, find the real test (file and name). If it does
   not exist, say so in Notes and do not mark the row `built`.
3. Run the suites; record pass/fail evidence (pipeline run or command
   output) in the release record.
4. Set Status. Use `stubbed` for anything that works only through a
   development adapter (FR-IAM-001/002 OTP delivery, FR-SUB-003 payments,
   FR-NTF-004 channels).
5. Where the implementation's values differ from a spec default marked ◊,
   update the spec to the implemented value (or file a defect) — do not
   leave the two disagreeing.
6. Re-check `functional-requirements.md` §22: close gaps the contract has
   since filled; add any new ones.
7. Count: rows `built` / `partial` / `stubbed` / `planned` by priority, and
   report P0 rows that are not `built` as release blockers (PRD §11).
