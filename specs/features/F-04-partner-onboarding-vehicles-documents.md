# F-04 — Partner onboarding, vehicles, documents and owner↔driver authorisation

| | |
| --- | --- |
| Requirements | FR-PRT-001 … FR-PRT-017 |
| Priority / release | P0 core; P1 authorisation, hours, metrics, fleet; P2 pre-registration · R1 |
| Contract | `marketplace.ts`; `ApiRoutes.driver.{profile, submitForReview, vehicles, vehicle, rates, documents, availability, location, authorizations, acceptAuthorization, revokeAuthorization, metrics}`, `ApiRoutes.uploads.*` |
| API module | `apps/api/src/modules/marketplace` (+ `platform` storage port) |
| Web | `features/partner` |
| ADRs | 0011 object-storage port · 0007 PWA first |

## 1. Business objective and scope

Turn a person with a phone into a listed, bookable partner — and make sure
the person behind the wheel is entitled to drive the vehicle that is listed.

**In scope** — partner profile; vehicles and photos; document submission;
uploads; onboarding checklist and submit-for-review; indicative rates;
availability; location pings; owner↔driver authorisations; fleet limits;
metrics.
**Out of scope** — the review itself (F-05); the request inbox and quotes
(F-07); plans (F-11).

## 2. User stories and acceptance criteria

- **US-01** As a driver I create my profile and say where I work.
- **US-02** As an owner I add my vehicle with photos and my rates.
- **US-03** As a partner I upload my documents and see what is still missing.
- **US-04** As a verified driver I go available with one tap.
- **US-05** As a fleet owner I authorise a driver for a vehicle and can take
  that back.
- **US-06** As a hired driver I can only work with a vehicle I am authorised for.
- **US-07** As a partner I see how I am doing.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F04-01 | a driver-role user with no profile | `GET /driver/profile` | `200` with body `null` |
| AC-F04-02 | the same user | `PUT /driver/profile` with a valid `UpsertDriverProfileRequest` | `200 DriverProfile` with `verificationStatus: "incomplete"`, `listingStatus: "unlisted"`, `availability: "offline"`, `onboarding.profile: true` |
| AC-F04-03 | a `serviceAreas` entry that is not a known region slug, or an empty list | upsert profile | `400 validation_failed` on `serviceAreas` |
| AC-F04-04 | a partner on a plan with `maxVehicles = 1` and one vehicle | `POST /driver/vehicles` | `403 entitlement_exceeded` |
| AC-F04-05 | a valid `UpsertVehicleRequest` | `POST /driver/vehicles` | `201 Vehicle` owned by the caller, `verificationStatus: "incomplete"`, `listingStatus: "unlisted"`; registration stored normalised (upper case, no spaces/hyphens) |
| AC-F04-06 | a registration number already on another active vehicle | create or update vehicle | `409 conflict` |
| AC-F04-07 | a vehicle owned by partner A | partner B calls `PUT`/`DELETE /driver/vehicles/{id}` or `PUT /driver/rates` for it | `404 not_found` |
| AC-F04-08 | a category with `minPerKm` ₹12 and `maxPerKm` ₹30 | `PUT /driver/rates` with `perKmMinor` outside 1 200–3 000 | `400 validation_failed` on `perKmMinor`; inside → `200 Vehicle` with `rates` |
| AC-F04-09 | an authenticated user | `POST /uploads/presign` with an allowed type and `sizeBytes ≤ UPLOAD_MAX_BYTES` | `200 PresignUploadResponse`; a disallowed type or larger size → `400 validation_failed` |
| AC-F04-10 | an uploaded file key | `POST /driver/documents` with `type`, `fileKey`, number, `expiresOn` | `201 DriverDocument` `status: "pending"` with `numberMasked` showing only the last four characters |
| AC-F04-11 | a `fileKey` that was presigned for another user, never uploaded, or of a different purpose | submit document | `400 validation_failed` on `fileKey` |
| AC-F04-12 | a vehicle document type without `vehicleId`, a person document with `vehicleId`, or a `vehicleId` the caller does not own | submit document | `400 validation_failed` |
| AC-F04-13 | profile, ≥ 1 vehicle, both `PERSON_DOCUMENT_TYPES` and every `REQUIRED_VEHICLE_DOCUMENT_TYPES` for ≥ 1 vehicle submitted | `POST /driver/profile/submit` | `200 DriverProfile` `verificationStatus: "pending"`; before that, `409 conflict` listing the missing checklist items |
| AC-F04-14 | a partner whose verification is not `approved` | `PUT /driver/availability` to `available` | `403 driver_not_verified` |
| AC-F04-15 | an approved owner-driver with an approved vehicle | `PUT /driver/availability { status: "available", vehicleId }` | `200 DriverProfile` `availability: "available"`, `activeVehicleId` set |
| AC-F04-16 | an approved hired driver naming a vehicle they neither own nor hold an `active` authorisation for | go available | `403 vehicle_not_authorized` |
| AC-F04-17 | a vehicle whose required document is `expired` or not `approved` | go available with it | `403 document_expired` (expired) / `403 driver_not_verified` (not approved) |
| AC-F04-18 | an available driver | `POST /driver/location` with a `recordedAt` ≤ 5 min old | `204`; the single stored position is replaced; a `recordedAt` older than 5 min or in the future → `400 validation_failed` |
| AC-F04-19 | an owner | `POST /driver/authorizations` for their vehicle and a driver phone | `201 VehicleAuthorization` `status: "invited"` with `driverPhoneMasked`; a vehicle they do not own → `404`; their own phone → `400` |
| AC-F04-20 | an invited driver (account with that phone and the driver role) | `POST /driver/authorizations/{id}/accept` | `200` `status: "active"`; anyone else → `404` |
| AC-F04-21 | an active authorisation, the hired driver available with that vehicle | owner (or the driver) calls `…/revoke`, or `validUntil` passes | `status: "revoked"` / `"expired"`; the driver's availability becomes `offline` and `activeVehicleId` null within one request / one job cycle; their active quotes with that vehicle are closed |
| AC-F04-22 | a partner with activity | `GET /driver/metrics?periodDays=30` | `200 DriverMetrics` consistent with requests offered, quotes, bookings and reviews in the window; `cancellationRate` null under 5 bookings |

## 3. Preconditions, postconditions and business rules

**Preconditions** — account holds the driver role (F-01).

| # | Rule |
| --- | --- |
| BR-01 | One partner profile per account. `partnerType` describes how the partner works; it does not grant rights by itself — ownership and authorisations do. |
| BR-02 | `OnboardingChecklist`: `profile` (profile saved) · `vehicle` (≥ 1 vehicle the partner owns **or** ≥ 1 active authorisation) · `personDocuments` (identity and driving licence submitted, not rejected; a `fleet_owner` who does not drive needs identity only) · `vehicleDocuments` (every `REQUIRED_VEHICLE_DOCUMENT_TYPES` submitted for ≥ 1 owned vehicle; not applicable to a `hired_driver`) · `readyForReview` = all applicable items true. |
| BR-03 | A vehicle is *operable* when its `verificationStatus` is `approved`, `listingStatus` is `published`, and each required document is `approved` with `expiresOn` in the future (or null where the document has no expiry). |
| BR-04 | A driver may operate a vehicle when they own it or hold an authorisation with `status: "active"` and `validUntil` null or in the future. |
| BR-05 | Going `available` requires: driver `approved`; `vehicleId` given; BR-03; BR-04; the vehicle not currently active for another available driver; region of service `live`. |
| BR-06 | `busy` and `offline` need no vehicle. Availability is set by the driver; the platform does not auto-toggle it during bookings (assumption A-2). |
| BR-07 | Location: one row per driver, overwritten. Freshness from age: ≤ `LOCATION_LIVE_MAX_AGE_SECONDS` live, ≤ `LOCATION_RECENT_MAX_AGE_SECONDS` recent, else stale. Client cadence ◊: every 30 s while `available` **and the app is in the foreground**. |
| BR-08 | Because a PWA cannot report position in the background, a driver whose position goes stale stays listed with freshness `stale` and no distance — never with a last-known distance (constitution §2.8, FR-PWA-008). |
| BR-09 | Rates: `minPerKm ≤ perKmMinor ≤ maxPerKm` of the vehicle's category; other amounts 0 – ₹1,00,000. Only the owner sets rates. |
| BR-10 | Vehicle count ≤ plan `maxVehicles` (F-11). Deleting a vehicle is refused while it has an active booking. |
| BR-11 | Changing `registrationNumber` or `categoryCode` of an approved vehicle resets it to `pending` and unlists it (FR-VER-006). |
| BR-12 | A newer document of the same type (and vehicle) supersedes the previous one; only the latest counts. |
| BR-13 | An authorisation is addressed to a phone number. If no account with that phone exists yet, it waits; it is offered when that phone signs in as a driver. One live (invited/active) authorisation per vehicle–phone pair. |
| BR-14 | Document files and numbers are sensitive personal data: private bucket, signed access, masked to the partner as `numberMasked`. |

## 4. Workflows

**Primary — owner-driver onboarding** — profile → vehicle (+ photos via
presign → PUT → attach keys) → rates → person documents → vehicle documents →
checklist complete → submit → wait for review (F-05) → go available.

**Primary — fleet** — owner adds vehicles and their documents → invites
drivers by phone → each hired driver onboards with profile + person documents
→ accepts the invitation → is reviewed → goes available with that vehicle.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Document rejected | Profile becomes `changes_requested`; the document card shows `rejectionReason` and `reviewerNote` with *Replace*; resubmission returns the case to `pending` |
| ALT-2 | Upload interrupted | The presigned URL remains valid until `expiresAt`; client retries the PUT; after expiry it presigns again |
| ALT-3 | Plan limit reached | Add-vehicle explains the limit and links to plans |
| ALT-4 | Geolocation denied | Driver can still be `available`; freshness is `unknown`; UI explains they will not appear in "nearest" and will not receive immediate requests (F-07 BR on matching) |
| ALT-5 | Tab backgrounded / phone locked | Pings stop; on return the client pings immediately; the dashboard states "Your location was last shared N min ago" |
| ALT-6 | Document expires while available | Job sets document `expired`, vehicle unlisted, driver taken offline, notification `document_expiring` earlier at 30, 7 and 1 days ◊ |
| ALT-7 | Invitee declines | They call `…/revoke` on the invitation |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Dashboard skeleton; checklist shows placeholders; upload shows per-file progress |
| Empty | No profile → guided start. No vehicles → illustration + *Add your vehicle*. No documents → the required list with *Upload* per item. No authorisations → explanation of when they are needed |
| Error | Per-card errors with *Try again*; upload failure keeps the selected file and offers retry; server validation mapped to fields |
| Retry | `PUT` operations are safe to repeat; uploads retry up to 3 times with back-off |
| Offline | Profile and vehicles read-only from last load; availability toggle disabled with "Connect to change availability"; queued location pings are dropped, not replayed |

## 6. API and database changes

| Operation | Request → response |
| --- | --- |
| `GET` · `PUT /driver/profile` | — / `UpsertDriverProfileRequest` → `DriverProfile \| null` / `DriverProfile` |
| `POST /driver/profile/submit` | — → `DriverProfile` |
| `GET` · `POST /driver/vehicles` | — / `UpsertVehicleRequest` → `Vehicle[]` / `Vehicle` |
| `PUT` · `DELETE /driver/vehicles/{vehicleId}` | `UpsertVehicleRequest` → `Vehicle` / `204` |
| `PUT /driver/rates` | `UpdateRatesRequest` → `Vehicle` |
| `GET` · `POST /driver/documents` | — / `SubmitDocumentRequest` → `DriverDocument[]` / `DriverDocument` |
| `PUT /driver/availability` | `UpdateAvailabilityRequest` → `DriverProfile` |
| `POST /driver/location` | `LocationPing` → `204` |
| `GET` · `POST /driver/authorizations` | — / `CreateAuthorizationRequest` → `VehicleAuthorization[]` / `VehicleAuthorization` |
| `POST /driver/authorizations/{authId}/accept` · `/revoke` | — → `VehicleAuthorization` |
| `GET /driver/metrics` | `?periodDays` → `DriverMetrics` |
| `POST /uploads/presign` | `PresignUploadRequest` → `PresignUploadResponse` |
| `PUT /uploads/local/{token}` | bytes → `204` (local-disk adapter only) |
| `GET /files/{token}` | → bytes (signed) |

Tables: `driver_profiles`, `vehicles`, `driver_documents`,
`vehicle_authorizations`, `driver_locations` (GiST), `uploads` bookkeeping
(pending keys). Jobs: `document-expiry` (daily), `authorization-expiry`
(daily), orphan-upload purge (daily).

## 7. Authorisation and security

- All routes `[driver]`; resource checks: vehicle owner for vehicle, rates and
  vehicle documents; owner **or** invitee for authorisations; self for profile,
  documents, availability, location.
- Upload keys are bound to the requesting user and purpose; attaching a key
  verifies ownership, existence, size and a magic-byte match with the declared
  content type (NFR-SEC-008).
- Document numbers are never returned in full to the partner API
  (`numberMasked`), never logged, never placed in audit metadata.
- Location pings are rate-limited (≤ 6 per minute per driver ◊) and accepted
  only from the driver's own session.
- Threats: forged documents (T-02), listing a vehicle one does not control
  (T-02, BR-04), location spoofing (accuracy and speed sanity checks are P2),
  upload abuse (size/type limits, per-user daily cap of 50 files ◊).

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `partnerType` | `PartnerType` |
| `displayName` | 2–60 chars |
| `bio` | ≤ 500 chars |
| `languages` | 1–6 items from a known language list (`en`, `kn`, `hi`, `kok`, `mr`, `ta`, `te`, `ml`) |
| `yearsExperience` | integer 0–60 or null |
| `serviceAreas` | 1–10 existing region slugs, unique |
| `operatingHours.days` | 1–7 unique integers 0–6; `from`/`to` `HH:mm`, `from ≠ to` (overnight spans allowed) |
| `photoKey` | omitted (keep current), `null` (remove), or a key presigned for the caller with purpose `profile_photo` and an image content type (not PDF) |
| `categoryCode` | active category |
| `make` / `model` | 1–40 chars |
| `year` | 1990 – current year + 1, or null |
| `color` | ≤ 30 chars |
| `registrationNumber` | after stripping spaces and hyphens and upper-casing, matches `INDIAN_VEHICLE_REGISTRATION` |
| `seats` | 1–`MAX_PASSENGERS`, ≥ 1 |
| `luggageCapacity` | 0–20 |
| `photoKeys` | ≤ 8 keys with purpose `vehicle_photo` |
| `SubmitDocumentRequest.type` | `DocumentType`; `vehicleId` required iff type ∉ `PERSON_DOCUMENT_TYPES` |
| `documentNumber` | ≤ 40 chars, `[A-Z0-9 /-]` |
| `expiresOn` | ISO date in the future (required for licence, insurance, permit, fitness, pollution certificate) |
| `PresignUploadRequest` | `purpose` ∈ `UploadPurpose`; `contentType` ∈ `UPLOAD_ALLOWED_CONTENT_TYPES` (PDF only for `driver_document`); `sizeBytes` 1…`UPLOAD_MAX_BYTES` |
| `LocationPing` | valid `LatLng`; `accuracyMeters` 0–10 000; `recordedAt` within the last 5 min and not > 30 s in the future |
| `CreateAuthorizationRequest.driverPhone` | `INDIAN_MOBILE_E164`, not the owner's own |
| `validUntil` | ISO date, today or later |
| `periodDays` | 7, 30 or 90 |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F04-01 | Unit | `OnboardingChecklist` for each `PartnerType` |
| UT-F04-02 | Unit | "May operate vehicle" policy: owner, active auth, invited, revoked, expired, none |
| UT-F04-03 | Unit | "Vehicle operable" policy across document states and expiry dates |
| UT-F04-04 | Unit | Rate bounds against category pricing |
| UT-F04-05 | Unit | Registration normalisation and `INDIAN_VEHICLE_REGISTRATION` |
| UT-F04-06 | Unit | `LocationFreshness` from age boundaries (119 s, 120 s, 899 s, 900 s) |
| IT-F04-01 | Integration | Profile → vehicle → documents → submit (AC-01…13) |
| IT-F04-02 | Integration | Upload presign → PUT → attach; foreign / missing key (AC-09…11) |
| IT-F04-03 | Integration | Availability gates (AC-14…17) |
| IT-F04-04 | Integration | Location overwrite and staleness (AC-18) |
| IT-F04-05 | Integration | Authorisation invite → accept → revoke / expiry takes driver offline (AC-19…21) |
| IT-F04-06 | Integration | Metrics aggregation (AC-22) |
| E2E-F04-01 | E2E | Driver completes onboarding on a 360 px viewport and sees "Submitted for review" |
| E2E-F04-02 | E2E | Approved driver toggles availability; geolocation mocked |
| NT-F04-01 | Negative | Cross-partner access to vehicle, rates, documents, authorisations |
| NT-F04-02 | Negative | Oversized / wrong-type upload; PDF as vehicle photo |
| NT-F04-03 | Negative | Customer-only account on every `/driver/*` route → `403` |
| NT-F04-04 | Negative | Stale / future location ping |

## 10. Performance and accessibility

- Onboarding works on the reference device: each step is its own lazy view;
  images are downscaled client-side to ≤ 1 600 px before upload; uploads show
  determinate progress.
- `POST /driver/location` p95 ≤ 100 ms (single upsert).
- File inputs have visible labels and accept camera capture on mobile
  (`capture` hint through the platform adapter); checklist state is conveyed
  by text and icon, not colour alone; the availability switch exposes
  `aria-checked` and its consequence in the label.

## 11. Deployment, rollback and observability

- **Config**: storage driver (`local` | `s3`), bucket, presign lifetimes,
  location cadence hints, document reminder days.
- **Migration**: tables above with PostGIS extension enabled first.
  **Rollback**: drop in dependency order; uploaded objects are removed by
  prefix.
- **Metrics**: onboarding funnel (profile → vehicle → documents → submitted →
  approved); upload failures; availability changes; location pings/min;
  share of available drivers with `live` freshness.
- **Audit**: `driver_profile.submitted`, `vehicle.created|updated|deleted`,
  `document.submitted`, `authorization.created|accepted|revoked`,
  `availability.changed` (sampled metric only, not audited per change).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | `DocumentType.OwnerAuthorisation` (a signed letter) and `VehicleAuthorization` (the in-app record) overlap; the contract does not say whether the letter is required. Assumed **optional supporting evidence**. |
| G-2 | `DriverListing` is keyed by driver with one primary `vehicle`. A `fleet_owner` who does not drive has vehicles but is not an operating driver; assumed **not listed personally** — their vehicles surface through the authorised drivers operating them. |
| G-3 | `OperatingHours` is a single window for all selected days (no split shifts, no per-day hours). |
| G-4 | `DriverMetrics.profileViews` implies a view counter not otherwise defined; see `driver_stats_daily` in the data model. |
| G-5 | *(closed)* Profile photo is set through `UpsertDriverProfileRequest.photoKey` (upload purpose `profile_photo`); omit to keep, `null` to remove. Covered by the validation table and IT-F04-02. |
| G-6 | No operation for the partner to pause their own listing (`ListingStatus.Unlisted` "or the partner paused it"). |
| A-1 | A `fleet_owner` needs identity only, not a driving licence (BR-02). |
| A-2 | Availability is manual; no automatic `busy` during a trip. |
| A-3 | One vehicle can be active for only one available driver at a time. |
