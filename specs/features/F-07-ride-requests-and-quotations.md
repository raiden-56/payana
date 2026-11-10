# F-07 — Ride requests and quotations

| | |
| --- | --- |
| Requirements | FR-REQ-001 … FR-REQ-019 |
| Priority / release | P0 (FR-REQ-004, 005, 017 P1) · R1 |
| Contract | `bookings.ts` (`CreateRideRequest`, `RideRequest`, `Quote`, `SubmitQuoteRequest`, `DriverRequestFeedItem`, `TripType`, `RideRequestStatus`, `QuoteStatus`, `REQUEST_TTL_MINUTES`, `MIN_ADVANCE_NOTICE_MINUTES`, `MAX_ADVANCE_DAYS`, `MAX_PASSENGERS`, `MAX_OPEN_REQUESTS_PER_CUSTOMER`, `MAX_QUOTE_LINE_ITEMS`), `catalog.ts` (`PlaceSuggestion`), `common.ts` (`Place`, `IDEMPOTENCY_KEY_HEADER`); `ApiRoutes.rideRequests.*`, `ApiRoutes.driver.{requests, request, quotes, withdrawQuote, declineRequest}`, `ApiRoutes.catalog.places` |
| API module | `apps/api/src/modules/bookings` |
| Web | `features/booking` (customer), `features/partner` (inbox, quote) |
| ADRs | 0012 polling · 0015 map deferred · 0017 money |

## 1. Business objective and scope

The heart of the marketplace: a customer describes a trip once; eligible
drivers answer with prices; the customer chooses. No price is set by the
platform, and choosing is safe against double taps and races.

**In scope** — the location picker; creating requests of all four trip types;
matching and fan-out; expiry; the driver inbox; quoting, withdrawing,
declining; comparing; accepting (creates the booking); cancelling a request.
**Out of scope** — what happens after acceptance (F-08); notification
delivery (F-15).

## 2. User stories and acceptance criteria

- **US-01** As a customer I say where from, where to, when, what vehicle and
  how many people — in under a minute on a phone.
- **US-02** As a customer I pick places without typing an address.
- **US-03** As a driver I see requests I can serve and answer with my price.
- **US-04** As a customer I compare quotes like for like and choose one.
- **US-05** As either party, a double tap or a flaky network never creates
  two requests, two quotes or two bookings.

### Location picker (FR-REQ-019)

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F07-01 | the request form | the customer opens the pickup picker | it offers, in order: *Use my current location*, saved places (signed-in), then curated places from `GET /places?regionSlug=<current>` grouped by `PlaceKind`; typing filters by `q` (debounced 250 ms) |
| AC-F07-02 | location permission granted | *Use my current location* | pickup becomes a `Place` `{ label: "Current location", location }`; if the point is in no `live` region the picker says so and does not accept it as pickup |
| AC-F07-03 | location permission denied or unavailable | the picker opens | the current-location row is disabled with the reason and how to enable it; curated and saved places still work |
| AC-F07-04 | an outstation request | the customer opens the drop picker | curated places from all regions are searchable (no `regionSlug` filter), including out-of-region endpoints such as an airport |
| AC-F07-05 | any chosen source | the request is submitted | pickup and drop are sent as `Place` (`label`, optional `address`, `location`); the server resolves `regionSlug` itself and ignores any client-sent value |

### Requests

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F07-06 | a signed-in customer, pickup in a `live` region | `POST /ride-requests` (`tripType: "immediate"`, pickup, drop, `categoryCode`, `passengers`) with an `Idempotency-Key` | `201 RideRequest` `status: "open"`, `expiresAt = createdAt + 10 min`, `driversNotified ≥ 0`, `quotes: []`, `estimate` set |
| AC-F07-07 | the same key and body sent again (also concurrently) | create | the same `RideRequest` (same `id`) is returned; one row exists |
| AC-F07-08 | the same key with a different body | create | `409 idempotency_key_reused` |
| AC-F07-09 | no `Idempotency-Key` header | create | `400 idempotency_key_required` |
| AC-F07-10 | `tripType: "scheduled"` | `scheduledAt` missing, < now + `MIN_ADVANCE_NOTICE_MINUTES`, or > now + `MAX_ADVANCE_DAYS` | `400 validation_failed` on `scheduledAt`; a valid value → `expiresAt = min(createdAt + 12 h, scheduledAt)` |
| AC-F07-11 | `tripType: "outstation"` | `returnAt ≤ scheduledAt`, or `FeatureFlag.Outstation` off | `400 validation_failed` / `403 feature_disabled` |
| AC-F07-12 | `tripType: "sightseeing"` with a valid active `packageId` | create | `201`; `drop` may be absent; `packageTitle` is set; with `FeatureFlag.Packages` off → `403 feature_disabled`; unknown package → `404` |
| AC-F07-13 | pickup outside every `live` region | create | `422 outside_service_area` |
| AC-F07-14 | a customer with `MAX_OPEN_REQUESTS_PER_CUSTOMER` open requests | create | `409 conflict` naming the limit |
| AC-F07-15 | `targetDriverId` of a listed driver | create | only that driver is offered the request (`driversNotified: 1`), flagged `directRequest: true`; an unlisted target → `404` |
| AC-F07-16 | an open request past `expiresAt` | the expiry job runs (or the request is read) | `status: "expired"`; active quotes → `closed`; customer notified `request_expired` |
| AC-F07-17 | the owner of an open request | `POST /ride-requests/{id}/cancel` | `200` `status: "cancelled"`; active quotes `closed`; a non-open request → `409 request_not_open` |
| AC-F07-18 | customer B | reads, cancels or accepts on customer A's request | `404 not_found` |

### Driver inbox and quotes

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F07-19 | a listed driver eligible for an open request | `GET /driver/requests` | the request appears as `DriverRequestFeedItem` with `customerFirstName` only — no phone, surname or customer ID — plus `distanceToPickupKm` (null if the driver's position is not fresh), `competingQuotes`, `myQuote: null` |
| AC-F07-20 | a driver not eligible (other category, other region, not listed, declined it, or not the target of a direct request) | list or `GET /driver/requests/{id}` | absent / `404 not_found` |
| AC-F07-21 | an eligible driver | `POST /driver/requests/{id}/quotes` with `vehicleId`, `fareMinor`, `validForMinutes` and an `Idempotency-Key` | `201 Quote` `status: "active"`, `validUntil = min(now + validForMinutes, request.expiresAt)`; the customer is notified `quote_received`; repeat with the same key returns the same quote |
| AC-F07-22 | the driver already has an active quote on the request | quote again (new key) | `409 conflict` — withdraw first |
| AC-F07-23 | a vehicle the driver may not operate, a vehicle of another category, or an inoperable vehicle | quote | `403 vehicle_not_authorized` / `400 validation_failed` / `403 document_expired` |
| AC-F07-24 | the plan's `monthlyQuoteLimit` is reached | quote | `403 entitlement_exceeded` |
| AC-F07-25 | the request is not `open` | quote | `409 request_not_open` |
| AC-F07-26 | the author of an active quote | `POST /driver/quotes/{id}/withdraw` | `200 Quote` `status: "withdrawn"`; it disappears from the customer's list; another driver's quote → `404` |
| AC-F07-27 | an eligible driver | `POST /driver/requests/{id}/decline` | `204`; the request no longer appears in their inbox; if they had an active quote it is withdrawn |

### Compare and accept

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F07-28 | an open request with three active quotes | `GET /ride-requests/{id}` | `quotes` contains the three active quotes with `driver`, `vehicle`, `fare`, `inclusions`, `exclusions`, `pickupNote`, `etaMinutes`, `validUntil`; withdrawn/expired quotes are not offered for acceptance |
| AC-F07-29 | an active quote | owner posts `…/quotes/{quoteId}/accept` with an `Idempotency-Key` | `201 Booking` `status: "confirmed"`; in one transaction: request → `booked` with `bookingId`, quote → `accepted`, every other active quote → `closed`; winner notified `quote_accepted`, others `quote_not_chosen` |
| AC-F07-30 | two accept calls for different quotes on the same request arrive together | both run | exactly one booking exists; the other call returns `409 request_not_open` |
| AC-F07-31 | the same accept repeated with the same key | accept | the same `Booking` is returned |
| AC-F07-32 | a quote that is expired, withdrawn or closed | accept | `409 quote_not_active` |
| AC-F07-33 | the quoting driver was suspended, went unlisted, or lost authorisation for the vehicle after quoting | accept | `409 quote_not_active`; the quote is closed |

## 3. Preconditions, postconditions and business rules

**Preconditions** — customer signed in (`[customer]`), account `active` or
`deletion_requested`; region `live`; category active.
**Postconditions** — on accept, a booking exists (F-08) and the request is
terminal.

| # | Rule |
| --- | --- |
| BR-01 | Field requirements by `tripType`: `immediate` — pickup, drop; no `scheduledAt`. `scheduled` — pickup, drop, `scheduledAt`. `outstation` — pickup, drop, `scheduledAt`, optional `returnAt`. `sightseeing` — pickup, `scheduledAt`, `packageId` **or** drop. |
| BR-02 | `scheduledAt` ∈ [now + `MIN_ADVANCE_NOTICE_MINUTES` (30), now + `MAX_ADVANCE_DAYS` (90)]; `returnAt` > `scheduledAt` and ≤ `scheduledAt` + 30 days ◊. |
| BR-03 | Expiry: `expiresAt = createdAt + REQUEST_TTL_MINUTES[tripType]` (10 / 720 / 1 440 / 1 440 min), capped at `scheduledAt` for advance trips. |
| BR-04 | Eligibility of a driver for a request: listed (F-05 BR-05); serves the pickup's region; operates or owns a published operable vehicle of `categoryCode` with `seats ≥ passengers`; has not declined; and is the target when `targetDriverId` is set. |
| BR-05 | Fan-out (A-09): `immediate` → eligible drivers who are `available` with `live`/`recent` position within 15 km ◊ of pickup. Other types → all eligible drivers. `driversNotified` is the count at creation; drivers who become eligible later still see the request in their inbox. |
| BR-06 | At most `MAX_OPEN_REQUESTS_PER_CUSTOMER` (3) open requests per customer; and no second open request with the same trip type, pickup (within 200 m) and time (within 30 min) ◊. |
| BR-07 | A quote: one active per driver per request; vehicle operable by that driver (F-04 BR-03/04) and of the requested category (A-10); `fareMinor` free-priced (A-11) within sanity bounds; `validForMinutes` 5–1 440; `validUntil ≤ request.expiresAt`. |
| BR-08 | Quotes count against `PlanEntitlements.monthlyQuoteLimit` when created; withdrawn quotes still count ◊. |
| BR-09 | Accept is serialised per request (`SELECT … FOR UPDATE` on the request row) and re-validates the quote and the driver inside the transaction. |
| BR-10 | `(idem)` operations store the key, a hash of the body and the response for 24 h, scoped to user + route. |
| BR-11 | The driver inbox never contains the customer's phone, surname, ID or exact saved-place label; `notes` are shown as written (customers are warned not to put phone numbers in notes; numbers matching a phone pattern are masked ◊). |
| BR-12 | `estimate` is computed once at creation (F-03 BR-05) and frozen. |
| BR-13 | Customer-visible quote ordering ◊: fare ascending, then driver rating descending. No quote is hidden by plan status. |
| BR-14 | A customer cannot quote on their own request even if they also hold the driver role. |

## 4. Workflows

**Primary — customer**

1. Form (pre-filled from search, F-06): trip type → pickup (picker) → drop
   (picker) → when → category → passengers / luggage → notes.
2. Estimate range appears as soon as both points and a category are set.
3. Not signed in → sign in (F-01) → return with the form intact.
4. Submit with a fresh UUID as `Idempotency-Key` (kept until a definitive
   response).
5. Request page: status, countdown to `expiresAt`, "offered to N drivers",
   quotes arriving (poll every 5 s ◊ while open and the tab is visible; 30 s
   when hidden).
6. Compare → accept → booking page (F-08).

**Primary — driver**

1. Inbox (poll 10 s ◊ while available): cards with trip, time, distance to
   pickup, estimate, competing quote count, time left.
2. Open → quote form: vehicle (pre-selected active vehicle), fare,
   inclusions/exclusions chips (`QUOTE_INCLUSION_SUGGESTIONS` + free text),
   pickup note, ETA (immediate), validity.
3. Submit → "Quote sent" → wait for the outcome notification.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | No eligible drivers (`driversNotified: 0`) | Request is still created; page explains and suggests widening category or scheduling; no dead end |
| ALT-2 | No quotes by expiry | Expired state with *Ask again* (prefilled new request) |
| ALT-3 | Direct request declined or expired | Offer *Ask everyone nearby* (new request without `targetDriverId`) |
| ALT-4 | Quote expires while the customer decides | Card shows "Expired"; accept is disabled; server enforces |
| ALT-5 | Network drops on submit | Client retries with the **same** key; success shows the created request |
| ALT-6 | Accept races with a withdraw | Whichever commits first wins; the loser gets `409 quote_not_active` and the list refreshes |
| ALT-7 | Driver goes offline | Their active quotes stay valid until `validUntil` (they may still honour an advance trip) |

## 5. Loading, empty, error, retry and offline states

| Screen | Loading | Empty | Error | Retry | Offline |
| --- | --- | --- | --- | --- | --- |
| Location picker | Skeleton rows; current-location row shows "Finding you…" (10 s timeout) | "No listed places here yet — use your current location" | Places fetch failed → saved places and current location still offered + *Try again* | Automatic once, then manual | Cached places (service worker) with "may be out of date"; current location still works |
| Request form | Estimate shows a shimmer | — | Field errors from `ProblemDetails.errors`; `outside_service_area`, limit and flag errors as form-level messages | Submit retried with the same idempotency key | Submit disabled: "You're offline — your details are kept" (form state persisted locally) |
| Request page | Skeleton of status + quote placeholders | "Waiting for quotes — offered to N drivers" with an animated, reduced-motion-safe indicator | Poll failure → "Reconnecting…" keeps last data; hard failure → *Try again* | Polling backs off 5 → 10 → 20 → 30 s | Last state shown with "Offline"; accept disabled |
| Driver inbox | Card skeletons | "No requests right now" + availability and location-freshness status | Inline error + *Try again* | Poll back-off | "Offline — you won't see new requests" |
| Quote form | Button progress | — | Field and business errors mapped to messages | Same key on retry | Disabled submit |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /places` | `PlaceSearchQuery` → `PlaceSuggestion[]` | public (F-03) |
| `GET /ride-requests` | `RideRequestListQuery` → `Paginated<RideRequest>` | customer |
| `POST /ride-requests` (idem) | `CreateRideRequest` → `RideRequest` | customer |
| `GET /ride-requests/{requestId}` | — → `RideRequest` | owner |
| `POST /ride-requests/{requestId}/cancel` | — → `RideRequest` | owner |
| `POST /ride-requests/{requestId}/quotes/{quoteId}/accept` (idem) | — → `Booking` | owner |
| `GET /driver/requests` | `PageQuery` → `Paginated<DriverRequestFeedItem>` | driver, verified |
| `GET /driver/requests/{requestId}` | — → `DriverRequestFeedItem` | driver, verified, eligible |
| `POST /driver/requests/{requestId}/quotes` (idem) | `SubmitQuoteRequest` → `Quote` | driver, verified, eligible |
| `POST /driver/quotes/{quoteId}/withdraw` | — → `Quote` | author |
| `POST /driver/requests/{requestId}/decline` | — → `204` | driver, eligible |

Tables: `ride_requests` (GiST on `pickup_location`; partial index on open
requests by region and category), `request_declines`, `quotes` (partial
unique index: one active quote per request + driver), `idempotency_keys`,
`outbox_events`. Jobs: `request-expiry` and `quote-expiry` (every minute).
Events: `ride_request.created`, `quote.submitted`, `quote.withdrawn`,
`quote.accepted`, `ride_request.expired`, `ride_request.cancelled`.

## 7. Authorisation and security

- Customer routes: owner-only by `customer_id`; foreign IDs → `404`.
- Driver routes: listed + eligible, evaluated per request on every call —
  eligibility is not cached across requests.
- Contact privacy: nothing in this feature discloses a phone number to either
  side; that happens only inside a booking (F-08).
- Abuse: request spam (BR-06, rate limit 10 creates / hour / customer ◊),
  quote spam and bait pricing (one active quote, plan limits, sanity bounds,
  audit of withdrawals, T-05), scraping the inbox for customer movements
  (inbox limited to eligible, listed drivers; no customer identity).
- `notes`, `pickupNote`, inclusions and exclusions are plain text, length
  limited, rendered escaped.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `tripType` | `TripType` |
| `pickup`, `drop` | `Place`: `label` 1–80, `address` ≤ 200, valid `LatLng`; pickup ≠ drop (≥ 100 m apart) |
| `scheduledAt`, `returnAt` | ISO date-time; BR-01, BR-02 |
| `categoryCode` | active category |
| `passengers` | integer 1–`MAX_PASSENGERS` and ≤ category `seats` |
| `luggage` | integer 0–20 |
| `notes` | ≤ 500 chars |
| `packageId`, `targetDriverId` | UUID; must exist and be active / listed |
| `Idempotency-Key` | required on `(idem)` routes; 16–100 chars `[A-Za-z0-9_-]` |
| `SubmitQuoteRequest.vehicleId` | UUID; BR-07 |
| `fareMinor` | integer 1 000 – 50 000 000 (₹10 – ₹5,00,000) ◊ |
| `inclusions`, `exclusions` | each ≤ `MAX_QUOTE_LINE_ITEMS` (8) items of 1–40 chars, unique |
| `pickupNote` | ≤ 200 chars |
| `etaMinutes` | integer 1–180; required for `immediate` |
| `validForMinutes` | integer 5–1 440 |
| `RideRequestListQuery.status` | `RideRequestStatus` |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F07-01 | Unit | Trip-type field rules and time windows (BR-01, 02) incl. boundary minutes |
| UT-F07-02 | Unit | Expiry computation per trip type, cap at `scheduledAt` |
| UT-F07-03 | Unit | Eligibility policy (BR-04) truth table |
| UT-F07-04 | Unit | Quote rules (BR-07) and `validUntil` cap |
| UT-F07-05 | Unit | Request and quote state machines |
| UT-F07-06 | Unit (web) | Location picker: source ordering, permission states, debounce, region filter on/off for outstation drop |
| UT-F07-07 | Unit (web) | Idempotency key lifecycle in the request store (reuse on retry, new on edit) |
| IT-F07-01 | Integration | Create each trip type; estimate; fan-out counts (AC-06, 10…12, 15) |
| IT-F07-02 | Integration | Idempotency: replay, concurrent duplicates, body mismatch, missing key (AC-07…09) |
| IT-F07-03 | Integration | Limits and service area (AC-13, 14) |
| IT-F07-04 | Integration | Expiry and cancel jobs/paths (AC-16, 17) |
| IT-F07-05 | Integration | Inbox contents and privacy — schema assertion that no customer phone/ID appears (AC-19, 20) |
| IT-F07-06 | Integration | Quote create / duplicate / vehicle rules / plan limit / withdraw / decline (AC-21…27) |
| IT-F07-07 | Integration | Accept: happy path, 20-way concurrent accept on different quotes yields one booking (AC-29…31) |
| IT-F07-08 | Integration | Accept re-validation after suspension / revocation / expiry (AC-32, 33) |
| E2E-F07-01 | E2E | Two browser contexts: customer creates an immediate request with curated places; driver quotes; customer accepts; both see the booking |
| E2E-F07-02 | E2E | Location denied path through the picker (AC-03) |
| E2E-F07-03 | E2E | Offline during submit → reconnect → single request created |
| NT-F07-01 | Negative | Ownership (AC-18), ineligible driver, customer-only account on driver routes |
| NT-F07-02 | Negative | Past `scheduledAt`, `returnAt` before start, passengers above seats, pickup = drop |
| NT-F07-03 | Negative | Quote on own request (BR-14); fare out of bounds; too many line items |

## 10. Performance and accessibility

- `POST /ride-requests` p95 ≤ 600 ms including fan-out selection (fan-out
  notification itself is asynchronous via the outbox). Accept: NFR-PERF-006.
- Polling payloads: request detail ≤ 8 kB gzip with 10 quotes; `ETag` /
  `304` on unchanged polls.
- Picker is a labelled combobox/listbox (`role="listbox"`, arrow keys, type
  to filter, Escape closes, focus returns to the trigger); groups have
  headings; each option announces label, kind and address.
- Date and time use native inputs with explicit labels and a stated time
  zone (IST).
- New quotes are announced through a polite live region ("New quote: ₹450
  from Raghu"); the countdown is not announced every tick.
- Quote cards are comparable by structure: same order of fields, fare as
  text, inclusions/exclusions as lists.

## 11. Deployment, rollback and observability

- **Flags**: `FeatureFlag.Outstation`, `FeatureFlag.Packages` gate trip types.
- **Config** ◊: immediate fan-out radius, polling intervals (served to the
  client via environment), sanity bounds.
- **Rollback**: forward-compatible migration; if accept logic must be
  disabled, set every region `coming_soon` (requests refused with
  `outside_service_area`) — the kill switch documented in the release plan.
- **Metrics**: requests by type/region; `driversNotified` distribution;
  time to first quote; quotes per request; accept rate; expiry rate;
  idempotent replays; accept conflicts (`409`).
- **Alerts**: time-to-first-quote p50 > 5 min for immediate requests in a
  live region (business); accept error rate > 2 %.
- **Audit**: `ride_request.created|cancelled`, `quote.submitted|withdrawn`,
  `quote.accepted` (with booking ID).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | Only curated places, saved places and device location exist; no geocoder (ADR-0015). No admin operation to curate places (F-03 G-1). |
| G-2 | `CreateRideRequest` has no preferred fare / budget field and no AC or language preference. |
| G-3 | `Quote` has no line-item amounts; inclusions/exclusions are labels only. |
| G-4 | No operation for a customer to reject a single quote or message a driver before booking. |
| G-5 | `DriverRequestFeedItem` has no `status`; expired/booked requests simply leave the feed, so a driver learns the outcome only by notification. |
| G-6 | `RideRequest.quotes` is unpaginated; bounded in practice by eligible drivers. |
| A-1 | Matching, fan-out radius, duplicate-request rule and quote ordering are defaults (A-09…A-11 in the PRD). |
| A-2 | A request with zero notified drivers is still created (ALT-1). |
