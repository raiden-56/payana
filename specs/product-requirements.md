# Payana — Product Requirements

*Version 1.0 · 2026-11-10 · governed by `specs/constitution.md`*

> **Source completeness.** The owner's brief (`specs/_source/master-build-prompt.md`)
> was received truncated part-way through §6 Module 2. Sections §1–§5 and §6
> Module 1 are complete. Everything this document says about marketplace
> listings, bookings, packages, subscriptions, advertisements, notifications
> and operations is derived from §1, §3, §4 and §5 — not from module
> definitions, which were never received. Requirements with no direct sentence
> in the brief are marked `inferred` in `functional-requirements.md`.

## 1. Vision

A visitor stepping off the bus at Gokarna, or a family planning a temple-and-
beach day from Kumta, can find a verified local driver, see what the trip
should cost, receive real quotations and confirm a booking in a few minutes on
a patchy 4G connection. A local driver with one auto or a small fleet can be
found, trusted and chosen without paying commission on every ride.

## 2. Problem

| Who | Problem today |
| --- | --- |
| Visitors | No national ride-hailing coverage; prices are negotiated on the spot with no reference; no way to tell a licensed, insured vehicle from any other; advance and outstation trips are arranged through hotel desks and phone numbers on walls. |
| Residents | Early-morning and late-evening rides, hospital runs and station transfers depend on knowing a driver personally. |
| Drivers and owners | Demand is seasonal and invisible; work comes from stands and middlemen; there is no portable reputation; fleet owners cannot show who is authorised to drive which vehicle. |
| The platform operator | Must build trust (verification), keep abuse out (OTP fraud, fake listings) and earn revenue without becoming a transport operator. |

## 3. Product definition

Payana combines five things named in §1 of the brief:

1. **Listings** — OLX-style browsable driver and vehicle listings per region.
2. **Nearby discovery and ride requests** — Rapido-style "who is near me now".
3. **Advance and outstation booking** — a request goes to eligible drivers,
   who answer with quotations; the customer compares and chooses.
4. **Sightseeing packages** — curated routes a customer can request as a trip.
5. **Monetisation** — driver subscriptions, featured listings, local business
   advertisements and a configurable booking fee.

Payana is a **marketplace and lead platform**. The driver sets the price in a
quotation; the customer pays the driver directly. The platform does not
dispatch, does not set fares and — at Release 1 — does not handle trip money.

## 4. Goals and non-goals

### Goals

| # | Goal | Measure (first 90 days after Gokarna launch) |
| --- | --- | --- |
| G1 | Customers get a usable answer fast | ≥ 70 % of immediate requests receive a first quote within 3 minutes; ≥ 60 % of all requests receive ≥ 2 quotes |
| G2 | Requests become trips | ≥ 35 % of requests are booked; ≥ 85 % of bookings complete |
| G3 | Supply is real and trusted | ≥ 150 verified drivers in Gokarna; 100 % of listed vehicles have approved, unexpired required documents |
| G4 | Drivers see value | ≥ 60 % of verified drivers send at least one quote per week in season |
| G5 | Revenue without commission | ≥ 15 % of verified drivers on a paid plan by day 90; ≥ 5 local advertisers |
| G6 | Safe and lawful | Zero confirmed incidents of customer phone-number or driver-location leakage; all consent-gated tags verified off before consent |
| G7 | Expandable | A second region is switched from `coming_soon` to `live` with no code deployment |

### Non-goals (Release 1)

- Metered fares, surge pricing or platform-set prices.
- Collecting or settling the trip fare.
- Turn-by-turn navigation or live trip tracking on a map.
- Automatic dispatch / driver assignment.
- Native Android and iOS apps (architecture is ready; packaging is Release 2).
- Shared rides / pooling, parcel delivery, self-drive rentals.
- Languages other than English in the UI (structure is ready for Kannada and Hindi).

## 5. Users and roles

Three account roles (`AccountRole`): `customer`, `driver`, `admin`. One account
may hold several. The driver role covers three partner types (`PartnerType`):
`owner_driver`, `fleet_owner`, `hired_driver`. The admin role is split into
five `AdminRole` values, of which `super_admin` is the separate privileged
role. Personas and journeys are in `personas-and-journeys.md`.

## 6. Scope by release

| Release | Theme | Contents |
| --- | --- | --- |
| **R1 — Foundation (this build)** | Working marketplace on development adapters | Phone-OTP identity with rotating sessions; admin sign-in with TOTP MFA and granular permissions; customer account, saved places, emergency contact, consent, deletion request; regions and vehicle categories as data; partner onboarding, vehicles, documents, owner↔driver authorisation; verification and listing moderation; PostGIS nearby search and public profiles; ride requests, quotations, acceptance; booking lifecycle, cancellation, receipts; reviews; support tickets; sightseeing packages; plans, subscriptions and invoices on the **manual** payment adapter; featured placements; local advertisements; in-app notifications via outbox; admin console; design system, motion and vector artwork; GA4 / Google Ads / AdSense settings with Consent Mode v2; PWA shell; health, logging, audit, idempotency, CI, Docker Compose, Terraform definitions. |
| **R1.1 — Launch hardening** | Everything that blocks real customers | Real SMS adapter with DLT-registered templates; payment gateway adapter and reconciliation; legal documents (terms, privacy notice, grievance contact); penetration test; production infrastructure applied; map/geocoding provider decision; Kannada UI; document malware scanning. |
| **R2 — Native and real time** | Depth | Capacitor Android / iOS packaging; native push, deep links, secure storage, camera, background location; SSE or WebSocket updates; refunds for booking fees; coupons; notification templates and delivery status; financial reporting; email sign-in and account linking. |
| **R3 — Regional expansion** | Breadth | Kumta, Honnavar, Murudeshwar, Karwar switched live; per-region pricing rules and campaigns; fleet reporting. |

Every requirement keeps its row in `functional-requirements.md` whatever its
release; nothing is removed because it is deferred (constitution §2.4).

### What "R1" does **not** mean

R1 is a functioning system on development adapters. It is **not** cleared to
serve the public until the R1.1 blockers in `deployment/release-plan.md` §8
are closed. In particular the OTP code is echoed by the development SMS
adapter and no money moves through the manual payment adapter.

## 7. Monetisation model

| Stream | Mechanism | Contract types | R1 state |
| --- | --- | --- | --- |
| Driver subscriptions | Plans (`SubscriptionPlan`) with entitlements: `maxVehicles`, `monthlyQuoteLimit`, `priorityInSearch`, `featuredDaysIncluded`, `badge`, `analytics` | `SubscriptionPlan`, `DriverSubscription`, `Invoice` | Built on `PaymentProvider.Manual` |
| Featured listings | Dated placement of a vehicle in a region; drawn from plan allowance or purchased | `FeaturedPlacement` | Built on manual adapter |
| Local business advertisements | Platform-sold campaigns in fixed placements (`AdPlacement`), always labelled "Sponsored" | `AdCampaign`, `AdCreative` | Built; sold offline, invoiced outside the system |
| Booking fee | `BookingFeeSettings` — flat + percent with cap, per booking | `BookingFare.bookingFee` | Computed and displayed; **disabled by default**; cannot be collected until a payment gateway exists |
| Google AdSense (optional) | Display ads as backfill in ad placements | `AnalyticsSettings.adsensePublisherId`, `adsenseSlots` | Settings ready; off until the owner supplies IDs |

Trip fares are outside the platform's revenue and outside its ledger.

## 8. Product principles specific to this domain

1. **A quote is a promise; an estimate is not.** `FareEstimate` is always a
   range labelled "estimate". `Quote.fare` is the price.
2. **Verified means documents checked** — identity, licence and each required
   vehicle document (`REQUIRED_VEHICLE_DOCUMENT_TYPES`) approved and unexpired.
3. **The person driving must be entitled to drive that vehicle** — owner, or
   holder of an `Active` `VehicleAuthorization`.
4. **Location honesty** — `LocationFreshness` governs what is shown; a stale
   position never produces a distance.
5. **Contact is earned** — phone numbers appear only inside an active booking,
   only to the other party.
6. **Paid placement is labelled** — `isFeatured`, plan badges and ads are
   visibly marked.

## 9. Assumptions

Each assumption was made because the brief is silent, ambiguous or truncated.
If one is wrong, the consequence column says what has to change.

| # | Assumption | Consequence if wrong |
| --- | --- | --- |
| A-01 | The missing remainder of §6 (rest of Module 2 and later modules) describes the same capabilities already listed in §1 and §5 A/B/C. | New FRs, feature specs and contract types; possible schema additions. Re-run traceability when the text arrives. |
| A-02 | Payana is a marketplace: drivers quote, customers choose, the fare is paid directly to the driver. | If the platform must collect fares: payment, settlement, refund, GST-on-fare and aggregator-licensing work that is not in R1; `Booking`/`Receipt` need payment state. |
| A-03 | Launch is India-only: phone numbers match `INDIAN_MOBILE_E164`, currency is INR, time zone is Asia/Kolkata. | Foreign tourists without an Indian SIM cannot sign in. Supporting them needs international SMS or email sign-in (FR-IAM-016, P2). **Material for a tourist town — see D-09.** |
| A-04 | One account = one phone number; a person who is both customer and driver uses the same account with two roles. | Separate accounts would need linking UX and duplicate-detection changes. |
| A-05 | The driver role is granted on first sign-in with `intent: "driver"`; it carries no privileges until verification is `approved`. | If driver sign-up must be invitation-only, add an approval gate before the role is assigned (`FeatureFlag.DriverSignUp` already allows closing sign-up). |
| A-06 | Admin accounts are created by a `super_admin` (or seed) and sign in by email + password + TOTP; they have no phone. | If admins must use SSO, the admin auth adapter changes; data model unaffected. |
| A-07 | TOTP MFA is **mandatory** for `super_admin` and enrolled on first sign-in for every admin role. | If MFA is optional for lower roles, relax FR-IAM-012; no schema change. |
| A-08 | Booking fee is disabled at launch (`BookingFeeSettings.enabled = false`) and the late-cancellation fee is zero while no gateway exists. | Enabling either before a payment adapter exists shows a fee nobody can collect. Guarded by FR-SUB-010 rule. |
| A-09 | An immediate request is offered only to drivers who are `available`, within the search radius of the pickup, with a `live` or `recent` position. Scheduled, outstation and sightseeing requests are offered to every eligible driver serving the pickup's region. | Different matching rules change FR-REQ-006 and the driver inbox query; no contract change. |
| A-10 | A driver must quote with a vehicle whose category equals the requested `categoryCode`. | If "equal or larger" vehicles may quote, relax FR-REQ-011. |
| A-11 | Quotes are free-priced; category `minPerKm`/`maxPerKm` constrain **published indicative rates**, not quotations. | If quotes must be bounded, add a fare-band rule and an error path to F-07. |
| A-12 | Only the last reported driver position is stored; there is no location history at R1. | Trip tracking, route audit and dispute evidence from GPS are unavailable. Adding history has privacy and retention consequences (NFR-PRIV-002). |
| A-13 | Customer updates arrive by polling (5 s on an open request, 15 s on an active booking, 60 s for notifications). | Higher battery/data use than push; superseded by R2 real-time work (ADR-0012). |
| A-14 | Distances and estimates use straight-line distance × a road factor (`FareEstimate.basis = "straight_line"`) until a routing provider is chosen. | Estimates on winding coastal/ghat roads are rough; ranges must be wide and labelled. |
| A-15 | There is no interactive map at R1; nearby drivers are shown as a list plus a distance/bearing "radar" graphic. | Customers expecting a map may trust the product less; a map provider is decision D-05. |
| A-16 | Places are entered by picking the device location, a saved place, or a curated point from `GET /places` (`PlaceSuggestion`: bus stands, stations, beaches, temples, town centres, landmarks — admin-curated data per region, including out-of-region outstation endpoints such as airports). Free-text geocoding needs a provider (D-05) and would sit behind the same `Place` shape. | Arbitrary addresses (a specific homestay, a lane) cannot be searched at R1; the customer picks the nearest curated point and describes the exact spot in `notes`. If that proves too coarse, D-05 becomes an R1.1 blocker. |
| A-17 | A booking becomes `disputed` when a support ticket of category `fare_dispute` or `safety` is opened against it by a party to the booking while it is active or within 7 days of completion. The contract has no dedicated "raise dispute" operation. | If disputes need their own operation or different triggers, add a route and adjust F-08/F-09. Recorded as a contract gap. |
| A-18 | Local advertisements take precedence in a placement; AdSense fills only when no local campaign is eligible and the owner has configured a slot. | If AdSense should compete or lead, change the selection rule in F-12/F-14. |
| A-19 | "Google Ads settings" in the owner's direction means **both** Google Ads conversion tracking (`AW-…` tag + conversion labels) and, optionally, Google AdSense display ads. | If only one was meant, the other set of fields is simply left empty; no rework. |
| A-20 | Refunds exist only for platform charges (subscriptions, featured placements, booking fee). Fare disagreements are handled as disputes between the parties with support mediation. | If the platform must refund fares, see A-02. |
| A-21 | "Payana" is a placeholder brand; palette and artwork are specified by role, not by brand name. | Renaming is a configuration change (constitution preamble). |
| A-22 | Data is hosted in AWS `ap-south-1` (Mumbai). | A different region or provider changes Terraform variables and the residency statement in the privacy notice. |
| A-23 | Review eligibility is: customer of the booking, status `completed`, within `REVIEW_WINDOW_DAYS`, one review per booking. Drivers do not review customers at R1. | Two-way reviews need new contract types. |
| A-24 | English UI at launch; all strings are externalised so Kannada and Hindi can be added without code changes. | If Kannada is required on day one, translation becomes an R1.1 blocker. |

## 10. Decisions needed from the owner

None of these blocks the R1 build. Each one blocks public launch or carries
business, security or regulatory weight. Items marked ⚖ **need professional
(legal / tax) advice — nothing in these specs is a legal conclusion.**

| # | Decision | Why it matters | Default until decided |
| --- | --- | --- | --- |
| D-01 | **Payment gateway and merchant KYC** (e.g. Razorpay) for subscriptions, featured placements and booking fees | Requires a registered business, bank account and KYC; determines refund and reconciliation design | `PaymentProvider.Manual`: no money moves; invoices are marked settled offline |
| D-02 | **SMS provider and DLT registration** (entity, header and OTP template registered under TRAI's DLT regime) | OTP SMS will not be delivered in India without it; lead time is typically days to weeks | Development SMS adapter echoes the code (`OtpChallenge.devCode`); never enabled in production |
| D-03 ⚖ | **Legal entity, terms of use, privacy notice and grievance contact** under the Digital Personal Data Protection Act, 2023 and the IT (Intermediary Guidelines) Rules | Consent wording, retention periods, grievance redressal and Data Fiduciary duties must be reviewed by counsel | Placeholder legal pages clearly marked "draft — not legal advice"; consent defaults are all off |
| D-04 ⚖ | **Regulatory position as a quotation marketplace** under the Motor Vehicles Act aggregator provisions, the central Motor Vehicle Aggregator Guidelines and Karnataka's aggregator rules | Whether a platform that does not dispatch or set fares needs an aggregator licence is a legal question these specs do not answer | Product is designed as a lead marketplace (A-02); launch is conditional on advice |
| D-05 | **Map, geocoding and routing provider** (Google Maps Platform, Mapbox, MapLibre + OSM, Ola Maps …) | Cost, terms of use, quality of local data; affects address search, real distances and a map view | No map; straight-line estimates; named-place picker (A-14–A-16, ADR-0015) |
| D-06 | **Brand name** — "Payana" is a working name | Trademark search and domain have not been done | Name isolated in one constant per app |
| D-07 | **Google AdSense alongside local ads?** | Display ads may cheapen a trust product and compete with local advertisers; AdSense also has its own policy and `ads.txt` requirements | AdSense fields exist and are empty (off) |
| D-08 | **The remainder of the brief** (§6 Module 2 onward) | A-01 | Proceed on §1/§5 |
| D-09 | **Foreign visitors without an Indian mobile number** | Gokarna has many international tourists; `INDIAN_MOBILE_E164` excludes them | India-only sign-in; email sign-in is specified as P2 |
| D-10 ⚖ | **GST treatment and invoice format** for subscriptions, featured placements and booking fees | `Invoice` has no tax fields; a tax invoice needs GSTIN, HSN/SAC and tax breakdown | Invoices are plain receipts, labelled "not a tax invoice" |
| D-11 | **Cancellation policy values** (free-cancellation window, late fee) | Commercial and fairness decision; fee needs D-01 | 60 minutes free window for advance trips; late fee ₹0 |
| D-12 | **Subscription price points and entitlements** | Seed plans are illustrative | Three seeded plans (`free`, `plus`, `pro`) editable in Admin → Plans |
| D-13 | **Document retention period** for driver identity and vehicle documents after a partner leaves | Privacy vs. dispute/regulatory evidence | 180 days after profile closure, then deletion (NFR-PRIV-003) |
| D-14 | **Driver background checks** beyond document review (police verification) | Safety expectation for tourist transport; operational cost | Not performed; "Verified" is defined narrowly as documents checked and is worded that way in the UI |
| D-15 | **Emergency / SOS handling** | Emergency contact is stored (FR-ACC-003) but nothing is sent automatically | Display-only at R1; no SOS workflow |

## 11. Release-1 acceptance

R1 is accepted when:

1. Every P0 requirement in `functional-requirements.md` has status `built` in
   `traceability-matrix.md` with passing automated tests.
2. Every P1 requirement has status `built`, `partial` or `stubbed` with the
   gap stated.
3. The end-to-end journey *customer request → driver quote → accept → driver
   transitions → complete → review* passes against a real PostgreSQL/PostGIS
   and Redis.
4. No colour outside the palette rules of F-13 appears in the compiled CSS.
5. With empty analytics identifiers, the web client makes zero requests to
   Google domains (F-14).
