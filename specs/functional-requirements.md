# Payana — Functional Requirements

*Version 1.1 · 2026-11-10 · 208 requirements*

## How to read this catalogue

- **ID** — `FR-<area>-NNN`. IDs are permanent; a withdrawn requirement keeps
  its row with status `withdrawn`.
- **Pri** — `P0` must work end to end in R1 · `P1` built in R1, may be
  `partial`/`stubbed` · `P2` specified now, built after R1.
- **Source** — where the brief asks for it. `§5.A-3` = section 5.A, third
  bullet (bullets are numbered in the order they appear in
  `specs/_source/master-build-prompt.md`). `§5.B-¶` and `§5.C-¶` are the
  closing paragraphs of those sections. `Owner` = the supplementary direction
  of 2026-11-10. `Const` = `specs/constitution.md`.
  **`inferred`** = no sentence in the brief asks for it; it is an assumption
  needed to make a stated capability work, or it stands in for the part of §6
  that was never received. Inferred requirements are listed again in §21 with
  the consequence of being wrong.
- **Feature** — the spec under `specs/features/` that owns it.
- Status lives only in `traceability-matrix.md`.

## 1. Identity and access — IAM (F-01)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-IAM-001 | A visitor can request a 6-digit one-time code by SMS to an Indian mobile number (`INDIAN_MOBILE_E164`), stating whether they are signing in as a customer or a driver. | P0 | §5.A-1, §6.M1-1 |
| FR-IAM-002 | Verifying the code signs the person in; the first successful verification for a phone number creates the account with the role implied by `intent`. | P0 | §5.A-1, §6.M1-1 |
| FR-IAM-003 | OTP challenges expire, allow a bounded number of verification attempts, enforce a resend cooldown and are single-use. | P0 | §5.A-1, §6.M1-6 |
| FR-IAM-004 | A sign-in yields a short-lived access token and a long-lived refresh token; browsers receive the refresh token only as an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/auth`; native clients (`X-Client-Platform: native`) receive it in the body. | P0 | §6.M1-3, §4 Mobile |
| FR-IAM-005 | Refresh tokens rotate on every use; presenting an already-used refresh token revokes the whole session. | P0 | §6.M1-3, §6.M1-4 |
| FR-IAM-006 | A signed-in user can log out; the session's tokens stop working immediately. | P0 | §6.M1-4 |
| FR-IAM-007 | A signed-in user can list their sessions (device label, created, last used, current) and revoke any of them. | P1 | §6.M1-5 |
| FR-IAM-008 | Repeated OTP requests or failed verifications lock the phone number and/or throttle the source address for a period; the response states `retryAfterSeconds`. | P0 | §5.A-1, §6.M1-6 |
| FR-IAM-009 | An account can hold several roles; signing in with `intent: "driver"` adds the driver role to an existing customer account (subject to `FeatureFlag.DriverSignUp`). | P0 | §5 intro, §6.M1-7 |
| FR-IAM-010 | Every protected operation checks role and the caller's relationship to the resource on the server; failure returns `403 forbidden` (or `404 not_found` where existence must not be revealed). | P0 | §5.C-¶, §3 |
| FR-IAM-011 | Administrators sign in with email and password; passwords have a minimum length of `ADMIN_PASSWORD_MIN_LENGTH`. | P0 | §5.C-¶ |
| FR-IAM-012 | Administrator sign-in requires a TOTP second factor; a role that must use MFA and has not enrolled is forced through enrolment (`mfa_enrollment_required`) before any session is issued. | P0 | §5.C-¶ |
| FR-IAM-013 | Administrative permissions are granular (`Permission`) and assigned by `AdminRole` exactly as in `ADMIN_ROLE_PERMISSIONS`; `super_admin` is a separate privileged role. | P0 | §5.C-¶ |
| FR-IAM-014 | A suspended account cannot sign in, refresh or act; reinstatement restores access. | P0 | §6.M1-9 |
| FR-IAM-015 | A user who has lost access to their phone number can recover the account through a support-verified process. | P2 | §5.A-1, §6.M1-9 |
| FR-IAM-016 | An account can carry an email address (P1, attribute only); signing in by email and linking email to a phone account (P2). | P1 / P2 | §6.M1-2 |
| FR-IAM-017 | Security events — OTP lockouts, failed admin sign-ins, MFA failures, refresh-token reuse, session revocation — are written to the audit log. | P0 | §3, §5.C-15 |

## 2. Customer account and privacy — ACC (F-02)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-ACC-001 | A signed-in user can view and update display name, email and locale. | P0 | §5.A-2 |
| FR-ACC-002 | A user can keep up to `MAX_SAVED_PLACES` saved places (label, address, location, kind) and add, edit and delete them. | P1 | §5.A-2 |
| FR-ACC-003 | A user can store, replace and remove one emergency contact (name, phone, relationship). | P1 | §5.A-2 |
| FR-ACC-004 | A user can view and change consent for analytics, advertising and marketing messages; every flag defaults to false and essential processing never depends on them. | P1 | §5.A-14, §6.M1-8 |
| FR-ACC-005 | A user can request account deletion, see when erasure is scheduled (`ACCOUNT_DELETION_GRACE_DAYS`) and cancel the request before then. | P1 | §5.A-14, §6.M1-10 |
| FR-ACC-006 | When the grace period ends the account is erased: personal data is removed or irreversibly anonymised, sessions are revoked, and records that must be kept are retained without identifying the person. | P1 | §6.M1-10 |
| FR-ACC-007 | A user's locale preference (`Locale`) is stored and applied to the client. | P1 | §5.A-2 |
| FR-ACC-008 | A deletion request is refused while the user has an active booking or an open dispute. | P1 | inferred |

## 3. Catalogue: regions and categories — CAT (F-03)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-CAT-001 | Anyone can list regions that are `live` or `coming_soon`, with centre, radius, names and tagline. | P0 | §1, §5.C-9 |
| FR-CAT-002 | Anyone can list active vehicle categories with seats, luggage capacity, icon and pricing rules. | P0 | §5.A-3, §5.C-10 |
| FR-CAT-003 | Anyone can obtain a non-binding fare estimate (low–high range, distance, duration, basis) between two points for a category. | P0 | inferred (§5.A-5 "indicative rates") |
| FR-CAT-004 | An administrator with `catalog.manage` can create and update regions, including status. | P1 | §5.C-9 |
| FR-CAT-005 | An administrator with `catalog.manage` can create and update vehicle categories and their pricing rules. | P1 | §5.C-10 |
| FR-CAT-006 | Adding or activating a region requires no code change or deployment. | P0 | §1 |
| FR-CAT-007 | Anyone can read the public configuration (`PublicConfig`): app name, environment, analytics identifiers, feature flags, support contact, booking-fee settings, default region. | P0 | §5.C-16, Owner |
| FR-CAT-008 | Anyone can list curated pickup / drop points (`PlaceSuggestion`: bus stands, stations, beaches, temples, town centres, landmarks) filtered by region and label text, default 30 and at most 100 per call. A place's `regionSlug` may name a region outside the live markets (for example an airport used as an outstation endpoint). | P0 | §5.A-4, §5.C-9 |
| FR-CAT-009 | Curated places are reference data (region, label, address, point, `PlaceKind`, order, active flag) maintained by administrators with `catalog.manage` without a deployment. | P1 | §5.C-9, inferred |

## 4. Partner onboarding, vehicles and documents — PRT (F-04)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-PRT-001 | A driver-role user can create and update a partner profile: partner type, display name, bio, languages, experience, service areas, operating hours. | P0 | §5.B-2, §5.B-3, §6.M2-1 |
| FR-PRT-002 | A partner can add, edit and remove vehicles: category, make, model, year, colour, registration number, seats, luggage capacity, AC, photos. | P0 | §5.B-2, §6.M2-2 |
| FR-PRT-003 | A partner can submit documents — identity, driving licence, vehicle registration, insurance, permit, fitness, pollution certificate, owner authorisation — each with file, optional number and expiry. | P0 | §5.B-1 |
| FR-PRT-004 | Files are uploaded through a presigned request limited to `UPLOAD_ALLOWED_CONTENT_TYPES` and `UPLOAD_MAX_BYTES`. | P0 | §5.B-1, §4 Infra |
| FR-PRT-005 | The profile shows an onboarding checklist; when complete the partner can submit for review, moving verification to `pending`. | P0 | inferred (§5.B-1, §5.C-2) |
| FR-PRT-006 | A verified partner can set availability to available, busy or offline; going available names the vehicle being operated. | P0 | §5.B-3 |
| FR-PRT-007 | A partner can set operating hours (days, from, to) shown on the public profile. | P1 | §5.B-3 |
| FR-PRT-008 | A partner's device can report its position; the platform classifies it by `LocationFreshness` and never presents a stale position as current. | P0 | §5.B-9 |
| FR-PRT-009 | A vehicle owner can set indicative rates (base, per km, waiting, optional full day) that must lie inside the category's pricing rules. | P0 | §5.B-4 |
| FR-PRT-010 | A vehicle owner can authorise another driver to operate a vehicle by phone number, with optional end date; the invitee can accept; either party can revoke. | P1 | §5.B-16, §5.B-¶ |
| FR-PRT-011 | A driver can go available with a vehicle only if they own it or hold an `active`, unexpired authorisation, and the driver and the vehicle's required documents are approved and unexpired. | P0 | §5.B-¶ |
| FR-PRT-012 | A partner can list several vehicles up to the plan's `maxVehicles`. | P1 | §5.B-16, §5.B-12 |
| FR-PRT-013 | A partner can view performance metrics: enquiries, quotes sent, bookings won and completed, cancellation rate, rating, profile views. | P1 | §5.B-15 |
| FR-PRT-014 | A partner can view booking records and the total of quoted fares on completed bookings. | P1 | §5.B-11 |
| FR-PRT-015 | A partner can contact a customer only through the booking: the customer's phone number is disclosed only while that booking is active. | P0 | §5.B-10 |
| FR-PRT-016 | Service areas are a set of region slugs; the partner is discoverable and receives requests only in those regions. | P0 | §5.B-2 |
| FR-PRT-017 | Partners can pre-register (profile, vehicle, documents) in a `coming_soon` region but cannot go available there. | P2 | inferred |

## 5. Verification and listing moderation — VER (F-05)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-VER-001 | An administrator with `verification.read` can list verification cases filtered by status and region. | P0 | §5.C-2 |
| FR-VER-002 | The case view shows profile, vehicles, every document with full number, expiry and a short-lived signed file link, and the decision history. | P0 | §5.C-2, §5.C-3 |
| FR-VER-003 | An administrator with `verification.review` can approve or reject each document; rejection requires a `DocumentRejectionReason`. | P0 | §5.C-3 |
| FR-VER-004 | An administrator with `verification.review` can decide a case: approve, request changes, reject, suspend, reinstate; every decision except approve requires a note. | P0 | §5.C-2 |
| FR-VER-005 | Document expiry is tracked: the partner is warned in advance, an expired document becomes `expired`, and a vehicle or driver missing a required valid document is removed from search and cannot go available. | P1 | §5.C-3 |
| FR-VER-006 | Resubmitting a document, or changing a vehicle's registration number or category, returns the affected item to review. | P1 | §5.C-3 |
| FR-VER-007 | An administrator with `listings.moderate` can publish, unlist or suspend a vehicle listing with a reason. | P1 | §5.C-4 |
| FR-VER-008 | Every review and decision is audited and the partner is notified with the reason. | P0 | §5.C-15, §5.C-3 |
| FR-VER-009 | Only partners whose verification is `approved` and whose listing is `published` appear in search, receive requests or can quote. | P0 | §5.A-5, §5.C-4 |

## 6. Discovery — DSC (F-06)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-DSC-001 | Anyone can search for drivers near a point within a radius (`DEFAULT_SEARCH_RADIUS_KM`, max `MAX_SEARCH_RADIUS_KM`). | P0 | §5.A-3, §5.A-4, §4 Infra |
| FR-DSC-002 | Search can be filtered by region, vehicle category, minimum seats, verified-only and available-now. | P0 | §5.A-4 |
| FR-DSC-003 | Results can be sorted by `recommended`, `nearest`, `rating` or `price`. | P0 | inferred (§5.A-4) |
| FR-DSC-004 | Each result shows verified status, featured/plan labels, rating, languages, experience, completed trips, vehicle summary, indicative rates, service areas and availability. | P0 | §5.A-5 |
| FR-DSC-005 | The public never receives a driver's coordinates — only distance and a bearing rounded to 10°, and neither when the position is `stale` or `unknown`. | P0 | §5.B-9, Const §2.7 |
| FR-DSC-006 | Anyone can open a driver's public profile: listing data plus bio, member-since, partner type, all published vehicles, operating hours, cancellation rate. | P0 | §5.A-5 |
| FR-DSC-007 | Featured placements and plan priority affect ordering only under `recommended` and are always labelled. | P1 | §1 item 5 |
| FR-DSC-008 | Results are paginated (`DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`). | P0 | inferred |
| FR-DSC-009 | Without a search point, listings can be browsed region-wide. | P0 | §1 item 1 |
| FR-DSC-010 | Pickup, destination, date, time and trip type entered while searching carry over into the ride-request form. | P1 | §5.A-4 |

## 7. Ride requests and quotations — REQ (F-07)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-REQ-001 | A customer can request an immediate ride (pickup, drop, category, passengers, luggage, notes). The operation is idempotent. | P0 | §5.A-6, §3 |
| FR-REQ-002 | A customer can request a scheduled local trip between `MIN_ADVANCE_NOTICE_MINUTES` and `MAX_ADVANCE_DAYS` ahead. | P0 | §5.A-7, §1 item 3 |
| FR-REQ-003 | A customer can request an outstation trip, one-way or with a return time (subject to `FeatureFlag.Outstation`). | P0 | §1 item 3 |
| FR-REQ-004 | A customer can request a sightseeing trip tied to a package (subject to `FeatureFlag.Packages`). | P1 | §1 item 4 |
| FR-REQ-005 | A customer can address a request to one specific driver. | P1 | inferred (§1 item 1) |
| FR-REQ-006 | A request is offered to every eligible driver and records how many were notified. | P0 | §5.B-5 |
| FR-REQ-007 | A request stays open for `REQUEST_TTL_MINUTES[tripType]`, then expires. | P0 | inferred |
| FR-REQ-008 | A customer may hold at most `MAX_OPEN_REQUESTS_PER_CUSTOMER` open requests. | P0 | inferred (§6.M1-6 abuse prevention) |
| FR-REQ-009 | A verified driver sees an inbox of open requests offered to them, without the customer's phone number or surname. | P0 | §5.B-5 |
| FR-REQ-010 | A driver can submit a quotation: vehicle, fare, inclusions, exclusions, pickup note, ETA, validity. The operation is idempotent. | P0 | §5.B-6 |
| FR-REQ-011 | A quotation is accepted only if the driver is eligible for the request, may operate the vehicle, the vehicle matches the category, the driver has no other active quote on the request and the plan's monthly quote limit is not exhausted. | P0 | §5.B-4, §5.B-¶ |
| FR-REQ-012 | A driver can withdraw their active quotation. | P0 | §5.B-7 |
| FR-REQ-013 | A driver can decline a request, removing it from their inbox. | P0 | §5.B-7 |
| FR-REQ-014 | The customer sees all active quotations on their request with driver, vehicle, fare, inclusions, exclusions, ETA and validity, and can compare them. | P0 | §5.A-8, §5.A-9 |
| FR-REQ-015 | The customer can accept one active quotation; atomically a booking is created, the quotation becomes `accepted`, all others become `closed`, and the request becomes `booked`. The operation is idempotent and safe under concurrent attempts. | P0 | §5.A-9, §3 |
| FR-REQ-016 | The customer can cancel an open request; its active quotations are closed. | P0 | inferred |
| FR-REQ-017 | A request carries the fare estimate computed when it was created. | P1 | inferred |
| FR-REQ-018 | A quotation expires at `validUntil` (never later than the request's expiry) and can no longer be accepted. | P0 | §5.B-6 |
| FR-REQ-019 | Pickup and drop are chosen with a location picker offering the device's current position (pickup), the user's saved places and the curated places of FR-CAT-008; whichever source is used, the result is a `Place`. | P0 | §5.A-4 |

## 8. Bookings — BKG (F-08)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-BKG-001 | A booking records a human-readable code, the trip, the parties, the vehicle, the fare breakdown and the cancellation policy in force when it was made. | P0 | §5.A-10 |
| FR-BKG-002 | A customer can list bookings by scope (`active`, `past`, `all`). | P0 | §5.A-12 |
| FR-BKG-003 | A party to a booking can view its detail: status, timeline, policy, fare, vehicle with full registration number, and the actions they may take. | P0 | §5.A-10 |
| FR-BKG-004 | The driver of a booking can move it through the transitions in `DRIVER_BOOKING_TRANSITIONS`; any other transition is refused. | P0 | §5.B-8 |
| FR-BKG-005 | Customer or driver can cancel from a status in `CANCELLABLE_BOOKING_STATUSES` with a `CancellationReason`; the frozen policy determines any fee. | P0 | §5.A-10, §5.C-6 |
| FR-BKG-006 | Each party's phone number is visible only to the other party and only while the booking is in `ACTIVE_BOOKING_STATUSES`. | P0 | §5.A-10, §5.B-10 |
| FR-BKG-007 | A party to a completed booking can view its receipt. | P1 | §5.A-12 |
| FR-BKG-008 | A driver can list their bookings by scope. | P0 | §5.B-8, §5.B-11 |
| FR-BKG-009 | A driver who has arrived can mark the customer a no-show. | P1 | inferred (§5.B-8) |
| FR-BKG-010 | The server computes `allowedActions` for the caller; clients offer only those actions. | P0 | §5.C-¶ |
| FR-BKG-011 | The platform booking fee is computed from `BookingFeeSettings` at acceptance and frozen on the booking; it is zero while the fee is disabled. | P1 | §1 item 5 |
| FR-BKG-012 | A booking can be placed in `disputed` and resolved by an administrator with `bookings.resolve` to `completed` or `cancelled_by_admin` with a note. | P1 | §5.C-5 |
| FR-BKG-013 | Every status change appends an immutable timeline event (status, time, actor, note). | P0 | §3 |
| FR-BKG-014 | Platform charges on a booking (booking fee, late-cancellation fee) can be refunded by an administrator with `refunds.process`. | P2 | §5.C-6, §5.A-15 |

## 9. Reviews — REV (F-09)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-REV-001 | The customer of a completed booking can submit one review (rating 1–5, optional comment) within `REVIEW_WINDOW_DAYS`. | P1 | §5.A-13 |
| FR-REV-002 | A driver's published reviews and rating summary are public and paginated. | P1 | §5.A-5 |
| FR-REV-003 | The reviewed driver can post one public reply. | P1 | §5.B-17 |
| FR-REV-004 | An administrator with `reviews.moderate` can hide or re-publish a review with a reason. | P1 | §5.C-11 |
| FR-REV-005 | Rating average and count reflect published reviews only and are updated when a review is submitted or moderated. | P1 | inferred |

## 10. Support — SUP (F-09)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-SUP-001 | Any signed-in user can open a support ticket with category, subject and description, optionally tied to one of their bookings. | P1 | §5.A-13, §5.A-15 |
| FR-SUP-002 | A user can list and view their tickets and add messages. | P1 | §5.A-15 |
| FR-SUP-003 | An administrator with `support.manage` can list all tickets, reply, and change status and priority. | P1 | §5.C-11 |
| FR-SUP-004 | Tickets of category `safety` are created with priority `urgent`. | P1 | inferred |
| FR-SUP-005 | Refund requests are raised as tickets of category `refund_request`. | P1 | §5.A-15, §5.C-6 |
| FR-SUP-006 | Abuse reports are raised as tickets of category `abuse_report`; investigation tooling beyond the ticket and audit log is P2. | P1 / P2 | §5.C-11 |
| FR-SUP-007 | A driver can open and answer tickets about their own bookings and listing. | P1 | §5.B-17 |

## 11. Sightseeing packages — PKG (F-10)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-PKG-001 | Anyone can list active packages, optionally by region. | P1 | §1 item 4 |
| FR-PKG-002 | Anyone can view a package: summary, stops with durations, highlights, distance, duration, indicative price per category, best time. | P1 | §1 item 4 |
| FR-PKG-003 | A customer can start a sightseeing request from a package with the package pre-selected. | P1 | §1 item 4 |
| FR-PKG-004 | An administrator with `packages.manage` can create, edit, order and deactivate packages. | P1 | inferred |
| FR-PKG-005 | Packages can be switched off platform-wide with `FeatureFlag.Packages`. | P1 | §5.C-16 |

## 12. Subscriptions, featured listings and fees — SUB (F-11)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-SUB-001 | Anyone can list active subscription plans with price, period, entitlements and highlights. | P1 | §5.B-12 |
| FR-SUB-002 | A partner can view their current subscription: plan, status, period, auto-renew and usage against limits. | P1 | §5.B-14 |
| FR-SUB-003 | A partner can buy or change plan through a checkout that is idempotent and goes through the payment port. | P1 | §5.B-12, §3 |
| FR-SUB-004 | A partner can list their invoices. | P1 | §5.B-14 |
| FR-SUB-005 | A partner can stop auto-renewal; access continues to the period end. | P1 | §5.B-14 |
| FR-SUB-006 | Plan entitlements are enforced: vehicle count, monthly quote limit, search priority, badge, analytics access. | P1 | §5.C-7 |
| FR-SUB-007 | Subscriptions renew or lapse at period end (`active` → `past_due` → `expired`), reverting the partner to the free plan's entitlements. | P1 | §5.B-14, §5.C-7 |
| FR-SUB-008 | A partner can buy a featured placement for a vehicle in a region for 1–30 days, drawing on the plan's included days first. The operation is idempotent. | P1 | §5.B-13 |
| FR-SUB-009 | An administrator with `plans.manage` can create, edit, order and deactivate plans. | P1 | §5.C-7 |
| FR-SUB-010 | A `super_admin` can configure the booking fee (enabled, flat, percent, cap). | P1 | §1 item 5, §5.C-10 |
| FR-SUB-011 | Payments are taken through a real gateway adapter and reconciled against provider records by an administrator with `payments.reconcile`. | P2 | §5.C-7 |
| FR-SUB-012 | Coupons and promotional campaigns can be created and applied. | P2 | §5.C-13 |
| FR-SUB-013 | Financial reports (subscription revenue, booking-fee revenue, refunds) are available to an administrator with `reports.financial`. | P2 | §5.C-14 |

## 13. Local business advertisements — ADS (F-12)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-ADS-001 | Clients can fetch the advertisements eligible for a placement and region; each is shown labelled "Sponsored". | P1 | §1 item 5 |
| FR-ADS-002 | Impressions and clicks are recorded per campaign, rate-limited against inflation. | P1 | §5.C-8 |
| FR-ADS-003 | An administrator with `ads.manage` can create and edit campaigns: advertiser, creative, call to action, placements, regions, dates, weight, status. | P1 | §5.C-8 |
| FR-ADS-004 | Campaign status follows its dates: `scheduled` → `running` → `ended`; `paused` and `draft` are never served. | P1 | §5.C-8 |
| FR-ADS-005 | Each campaign reports impressions and clicks. | P1 | §5.C-8 |
| FR-ADS-006 | Local advertisements can be switched off platform-wide with `FeatureFlag.LocalAds`. | P1 | §5.C-16 |
| FR-ADS-007 | Competing campaigns share a placement in proportion to their weight. | P1 | §5.C-8 |

## 14. Notifications — NTF (F-15)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-NTF-001 | A signed-in user can list in-app notifications with an unread count. | P1 | §5.A-11 |
| FR-NTF-002 | A user can mark one or all notifications read. | P1 | §5.A-11 |
| FR-NTF-003 | Domain events produce notifications asynchronously through a transactional outbox, for every `NotificationType`. | P1 | §3 |
| FR-NTF-004 | SMS, push and email delivery sit behind channel ports; R1 ships in-app delivery plus development adapters. | P1 / P2 | §4 Mobile, §5.A-11 |
| FR-NTF-005 | Administrators with `notifications.manage` can edit notification templates and see delivery status. | P2 | §5.C-12 |
| FR-NTF-006 | Promotional messages are sent only to users whose `marketingMessages` consent is true. | P1 | §6.M1-8 |
| FR-NTF-007 | Clients poll for new notifications and for changes to open requests and active bookings. | P1 | inferred (ADR-0012) |

## 15. Admin console — ADM (F-16)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-ADM-001 | An administrator with `overview.read` sees operational KPIs and a 14-day trend. | P1 | §5.C-14 |
| FR-ADM-002 | An administrator with `users.read` can search and list accounts by phone, email, name, role and status. | P1 | §5.C-1 |
| FR-ADM-003 | An administrator with `users.suspend` can suspend (with reason) and reinstate an account. | P1 | §5.C-1, §6.M1-9 |
| FR-ADM-004 | An administrator with `bookings.read` can search, list and open any booking. | P1 | §5.C-5 |
| FR-ADM-005 | An administrator with `bookings.resolve` can resolve a disputed booking. | P1 | §5.C-5 |
| FR-ADM-006 | Platform settings (analytics, feature flags, support contact, booking fee, default region) can be read with `settings.read` and changed with `settings.manage`. | P0 | §5.C-16, Owner |
| FR-ADM-007 | An administrator with `audit.read` can search the audit log by action, actor, target and date. | P0 | §5.C-15 |
| FR-ADM-008 | A `super_admin` (`staff.manage`) can create staff accounts, change their role and suspend them. | P1 | §5.C-¶ |
| FR-ADM-009 | The console shows only the areas the signed-in administrator's permissions allow; the API enforces the same permissions independently. | P0 | §5.C-¶ |
| FR-ADM-010 | Every administrative mutation writes an audit entry with actor, action, target, non-sensitive metadata, address and request ID. | P0 | §3, §5.C-15 |
| FR-ADM-011 | Operational health (dependencies, job lag) is visible to administrators. | P2 | §5.C-16 |
| FR-ADM-012 | Feature flags (`FeatureFlag`) can be toggled at run time and take effect without deployment. | P0 | §5.C-16 |

## 16. Design system and experience — UX (F-13)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-UX-001 | The web client uses a tokenised palette of laterite red, marigold yellow, palm green, warm sand and ink. No purple, violet, indigo or blue appears anywhere. | P0 | Owner, Const §4 |
| FR-UX-002 | A reusable, accessible component set (buttons, fields, cards, chips, dialogs, toasts, tabs, navigation, tables) is used on every screen. | P0 | §4 Frontend |
| FR-UX-003 | Every screen is responsive from 320 px to 1440 px and beyond, designed mobile first. | P0 | §4 Frontend, Owner |
| FR-UX-004 | Illustration and iconography are original inline SVG: coastal scene, vehicles per `VehicleIcon`, package artwork per `PackageArtwork`, empty and error states. | P0 | Owner |
| FR-UX-005 | Content reveals on scroll and selected artwork is scroll-linked. | P0 | Owner |
| FR-UX-006 | Route changes and interactive controls are animated (transitions, micro-interactions). | P0 | Owner |
| FR-UX-007 | All non-essential motion is disabled under `prefers-reduced-motion: reduce`. | P0 | Const §2.11 |
| FR-UX-008 | Standard loading, empty, error-with-retry and offline presentations exist and are used by every networked screen. | P0 | §2 |
| FR-UX-009 | Forms use Reactive Forms with shared validators and a single pattern for showing field and server errors. | P0 | §4 Frontend |
| FR-UX-010 | The landing page presents: hero with search, vehicle categories, how it works, featured drivers, packages, regions, partner call to action, local ads, FAQ, footer. | P0 | Owner ("good layouts") |
| FR-UX-011 | Nearby results include a distance-and-bearing "radar" graphic in place of a map. | P1 | inferred (ADR-0015) |
| FR-UX-012 | Terms and privacy pages exist as clearly marked drafts pending legal review. | P1 | inferred |

## 17. Analytics and ads settings — ANL (F-14)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-ANL-001 | The GA4 measurement ID is run-time configuration; when set and permitted, Google Analytics is loaded. | P0 | Owner |
| FR-ANL-002 | The Google Ads tag ID and one conversion label per `ConversionEvent` are run-time configuration; configured conversions are reported. | P0 | Owner |
| FR-ANL-003 | An AdSense publisher ID and per-placement slot IDs are optional run-time configuration. | P1 | Owner (A-19) |
| FR-ANL-004 | While an identifier is empty its integration makes no network request and sends no data. | P0 | Owner |
| FR-ANL-005 | Google Consent Mode v2 is initialised with every signal denied; a consent banner lets the visitor grant or refuse analytics and advertising separately. | P0 | Const §2.7 |
| FR-ANL-006 | A page view is recorded on every completed route navigation. | P0 | Owner |
| FR-ANL-007 | Product events follow the taxonomy in F-14 §6. | P0 | Owner |
| FR-ANL-008 | No personal data — phone, name, email, coordinates, free text, account ID — is sent in any event or URL. | P0 | Const §2.7 |
| FR-ANL-009 | Admin → Settings validates each identifier against the contract's patterns before saving. | P0 | Owner |
| FR-ANL-010 | When the API is unreachable at start-up, the client falls back to a static configuration file. | P0 | Owner |
| FR-ANL-011 | For signed-in users the banner choice and `ConsentPreferences` stay in step. | P1 | §5.A-14 |
| FR-ANL-012 | When AdSense is enabled, an `ads.txt` file is served from the web origin. | P2 | inferred |

## 18. PWA, offline and mobile readiness — PWA (F-17)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-PWA-001 | The web client is an installable PWA (manifest, icons, service worker). | P0 | §4 Frontend |
| FR-PWA-002 | The application shell and the last-fetched catalogue load offline; an offline indicator is shown. | P0 | §2, §4 Frontend |
| FR-PWA-003 | Writes are not queued offline; the user is told the action needs a connection and can retry. | P0 | §2 |
| FR-PWA-004 | When a new version is available the user is prompted to reload. | P1 | inferred |
| FR-PWA-005 | Geolocation, storage, sharing, notifications and camera are reached through platform adapters; shared code contains no direct browser-only or native-only API calls. | P0 | §4 Mobile |
| FR-PWA-006 | The same application is packaged for Android and iOS with Capacitor. | P2 | §4 Mobile |
| FR-PWA-007 | Native push notifications, deep links, secure token storage, camera capture and background location are provided on native builds. | P2 | §4 Mobile |
| FR-PWA-008 | The product states what the PWA cannot do (background location, reliable push on iOS) wherever a driver would otherwise assume it. | P0 | §4 Mobile |
| FR-PWA-009 | Foreground geolocation handles prompt, granted, denied and unavailable explicitly. | P0 | §4 Mobile |

## 19. Platform operations — OPS (F-18)

| ID | Requirement | Pri | Source |
| --- | --- | --- | --- |
| FR-OPS-001 | Liveness and readiness endpoints report process and dependency health. | P0 | §4 Backend |
| FR-OPS-002 | Requests are logged as structured JSON with a request ID returned in `x-request-id`. | P0 | §4 Backend |
| FR-OPS-003 | Every error response is a `ProblemDetails` body with a stable `ErrorCode`. | P0 | §3 |
| FR-OPS-004 | Every request body, query and path parameter is validated at run time; unknown properties are rejected. | P0 | §3 |
| FR-OPS-005 | The API publishes OpenAPI documentation; the exported document is committed and checked in CI. | P0 | §3, §4 Backend |
| FR-OPS-006 | Schema changes are forward migrations run by tooling. | P0 | §3 |
| FR-OPS-007 | Operations marked `(idem)` in `ApiRoutes` require `Idempotency-Key` and return the original result for a repeated key. | P0 | §3 |
| FR-OPS-008 | Asynchronous work runs from a transactional outbox and scheduled jobs (request/quote expiry, document expiry, subscription renewal, campaign status, account erasure, retention purges). | P0 | §3, §4 Backend |
| FR-OPS-009 | `docker compose` brings up local PostgreSQL + PostGIS and Redis. | P0 | §4 Infra |
| FR-OPS-010 | CI runs lint, type-check, tests and builds as merge gates. | P0 | §4 Infra |
| FR-OPS-011 | AWS infrastructure is defined in Terraform. | P1 | §4 Infra |
| FR-OPS-012 | Configuration comes from the environment; secrets come from a secret manager and never from the repository. | P0 | §3 |
| FR-OPS-013 | Metrics and traces are emitted for requests, database, jobs and outbox. | P1 | §1 ("observability") |
| FR-OPS-014 | Rate limits are enforced centrally with shared state in Redis. | P0 | §4 Infra |
| FR-OPS-015 | Seed data provides regions, vehicle categories, plans, packages and the first `super_admin`. | P0 | inferred |
| FR-OPS-016 | An append-only audit log service is available to every module. | P0 | §3 |

## 20. Brief coverage index

Every capability bullet in the brief, and the requirements that answer it.

### §5.A End user / customer

| Bullet | Capability | Requirements |
| --- | --- | --- |
| A-1 | Phone OTP, rate limits, recovery | FR-IAM-001…003, 008, 015 |
| A-2 | Profile, preferences, saved places, emergency contact | FR-ACC-001, 002, 003, 007 |
| A-3 | Discover nearby vehicles by category | FR-DSC-001, FR-CAT-002 |
| A-4 | Search by location, radius, pickup, destination, date, time, type, capacity, trip type | FR-DSC-001, 002, 010; FR-REQ-001…004, 019; FR-CAT-008 |
| A-5 | Driver profiles, verified status, vehicle, rates, ratings, areas | FR-DSC-004, 006; FR-REV-002 |
| A-6 | Immediate ride | FR-REQ-001 |
| A-7 | Advance bookings | FR-REQ-002, 003 |
| A-8 | Multiple quotations | FR-REQ-006, 014 |
| A-9 | Compare and select | FR-REQ-014, 015 |
| A-10 | Booking details, status, policy, contact | FR-BKG-001, 003, 005, 006 |
| A-11 | Booking notifications | FR-NTF-001…003 |
| A-12 | History and receipts | FR-BKG-002, 007 |
| A-13 | Reviews and issue reports | FR-REV-001; FR-SUP-001 |
| A-14 | Consent, privacy, deletion | FR-ACC-004…006; FR-ANL-005, 011 |
| A-15 | Help, complaints, refunds, support | FR-SUP-001, 002, 005; FR-BKG-014 |

### §5.B Driver / vehicle owner

| Bullet | Capability | Requirements |
| --- | --- | --- |
| B-1 | Register and submit documents | FR-IAM-009; FR-PRT-003, 004, 005 |
| B-2 | Vehicle profiles, photos, categories, capacity, areas | FR-PRT-001, 002, 016 |
| B-3 | Availability and operating hours | FR-PRT-006, 007 |
| B-4 | Indicative rates within platform rules | FR-PRT-009 |
| B-5 | Receive and respond to requests | FR-REQ-006, 009 |
| B-6 | Submit quotations | FR-REQ-010, 011, 018 |
| B-7 | Accept or decline | FR-REQ-012, 013 |
| B-8 | Manage bookings and transitions | FR-BKG-004, 008, 009 |
| B-9 | Availability without claiming a stale location | FR-PRT-008; FR-DSC-005 |
| B-10 | Contact customers through authorised channels | FR-PRT-015; FR-BKG-006 |
| B-11 | Earnings / booking records | FR-PRT-014; FR-BKG-008 |
| B-12 | Subscribe to plans | FR-SUB-001, 003 |
| B-13 | Featured placements | FR-SUB-008 |
| B-14 | Subscription status, invoices, renewals, expiry | FR-SUB-002, 004, 005, 007 |
| B-15 | Performance metrics | FR-PRT-013 |
| B-16 | Fleet vehicles and authorised drivers | FR-PRT-010, 012 |
| B-17 | Respond to reviews and complaints | FR-REV-003; FR-SUP-007 |
| B-¶ | Owner vs. driver relationship validated | FR-PRT-010, 011; FR-REQ-011 |

### §5.C Platform administrator

| Bullet | Capability | Requirements |
| --- | --- | --- |
| C-1 | User and account management | FR-ADM-002, 003 |
| C-2 | Driver, owner, vehicle verification | FR-VER-001, 002, 004 |
| C-3 | Document review, reasons, expiry, re-verification | FR-VER-003, 005, 006 |
| C-4 | Listing approval, suspension, removal | FR-VER-007, 009 |
| C-5 | Booking monitoring and disputes | FR-ADM-004, 005; FR-BKG-012 |
| C-6 | Cancellation and refunds | FR-BKG-005, 014; FR-SUP-005 |
| C-7 | Plans, entitlements, renewals, reconciliation | FR-SUB-006, 007, 009, 011 |
| C-8 | Advertisement inventory, campaigns, placement, reporting | FR-ADS-001…007 |
| C-9 | Service areas and locations | FR-CAT-004, 006, 008, 009 |
| C-10 | Categories and pricing rules | FR-CAT-005; FR-SUB-010 |
| C-11 | Tickets, abuse, ratings moderation, fraud | FR-SUP-003, 006; FR-REV-004 |
| C-12 | Notification templates and delivery status | FR-NTF-005 |
| C-13 | Coupons and promotions | FR-SUB-012 |
| C-14 | Financial and operational reporting | FR-ADM-001; FR-SUB-013 |
| C-15 | Audit logs and security events | FR-ADM-007, 010; FR-IAM-017 |
| C-16 | Feature flags, configuration, health | FR-ADM-006, 011, 012; FR-CAT-007; FR-OPS-001 |
| C-¶ | Separate privileged role, MFA, server-side enforcement | FR-IAM-010…013; FR-ADM-009 |

### §6 Functional modules (as received)

| Bullet | Capability | Requirements |
| --- | --- | --- |
| M1-1 | Phone OTP | FR-IAM-001, 002 |
| M1-2 | Optional email auth and linking | FR-IAM-016 |
| M1-3 | Session and refresh tokens | FR-IAM-004, 005 |
| M1-4 | Logout and revocation | FR-IAM-005, 006 |
| M1-5 | Device / session management | FR-IAM-007 |
| M1-6 | Lockout and abuse prevention | FR-IAM-003, 008; FR-OPS-014 |
| M1-7 | Role assignment and authorisation | FR-IAM-009, 010, 013 |
| M1-8 | Consent and privacy preferences | FR-ACC-004; FR-ANL-005 |
| M1-9 | Suspension and recovery | FR-IAM-014, 015; FR-ADM-003 |
| M1-10 | Secure account deletion | FR-ACC-005, 006, 008 |
| M2-1 | Driver and owner profiles | FR-PRT-001; FR-DSC-006 |
| M2-2 | Vehicle listings with searchab… *(truncated)* | FR-PRT-002; FR-DSC-001…004, 009 |
| M2-3 … | *(not received)* | covered only as far as §1 and §5 describe |

### §1–§4 cross-cutting

| Source | Requirements |
| --- | --- |
| §1 items 1–5 (product scope) | FR-DSC-009; FR-DSC-001; FR-REQ-002, 003; FR-PKG-001…003; FR-SUB-001…010, FR-ADS-001…007 |
| §1 expansion to other regions | FR-CAT-001, 004, 006 |
| §3 architecture principles | FR-OPS-003…008, 012, 016; FR-REQ-015; FR-IAM-010 |
| §4 frontend | FR-UX-002, 003, 008, 009; FR-PWA-001, 002 |
| §4 mobile strategy | FR-PWA-005…009; FR-IAM-004 |
| §4 backend | FR-OPS-001…005, 008 |
| §4 database and infrastructure | FR-DSC-001; FR-OPS-009…011, 014; FR-PRT-004 |
| Owner direction 2026-11-10 | FR-UX-001…007, 010; FR-ANL-001…010 |

## 21. Inferred requirements and their risk

| ID | Why it was inferred | If the assumption is wrong |
| --- | --- | --- |
| FR-ACC-008 | Erasing an account mid-trip would orphan a live booking. | Remove the guard; define how an active booking is closed on erasure. |
| FR-CAT-003 | Customers need a reference price before quotes; the brief only says "indicative rates". | Drop the estimate; UI shows driver rates only. |
| FR-CAT-009 | The brief asks for "service-area and location management"; that curated points are part of it is an inference from the launch decision to defer a geocoder (ADR-0015). | With a geocoder the curated list shrinks to a shortlist of popular points; the table and operation remain. |
| FR-PRT-005 | A review queue needs an explicit "ready" signal. | Review starts on first upload instead; queue becomes noisier. |
| FR-PRT-017 | `RegionStatus.ComingSoon` implies pre-registration. | Coming-soon regions become display-only. |
| FR-DSC-003, 008 | Any list needs ordering and paging. | None realistic. |
| FR-REQ-005 | OLX-style listings imply contacting a specific driver. | Remove `targetDriverId`; profiles become browse-only. |
| FR-REQ-007, 008, 016, 017 | A request/quote model needs lifetimes, limits and a way out. | Values in `bookings.ts` change; no structural change. |
| FR-BKG-009 | A driver who arrives to nobody needs an outcome. | Drop `no_show`; driver cancels with `customer_unreachable`. |
| FR-REV-005 | Ratings must be consistent with visible reviews. | None realistic. |
| FR-SUP-004 | Safety reports should not wait in a normal queue. | Priority set manually. |
| FR-PKG-004 | §5.C does not list packages, but they must be maintained by someone. | Packages become seed-only data. |
| FR-NTF-007 | Real-time transport is deferred (ADR-0012). | Bring SSE/WebSocket into R1. |
| FR-UX-011, 012 | Map provider and legal text are undecided (D-05, D-03). | Replace with map / final legal pages. |
| FR-ANL-012 | AdSense requires `ads.txt` for authorised sellers. | Only relevant if D-07 is "yes". |
| FR-PWA-004 | Service workers serve stale shells without an update prompt. | Users may run an old client until all tabs close. |
| FR-OPS-015 | A system with configurable catalogue needs initial data. | Operators enter everything by hand. |

## 22. Contract gaps recorded against requirements

These requirements have **no operation in `packages/contracts/src/routes.ts`**.
They are specified so they are not lost; none may be implemented by inventing
an endpoint outside the contract process (`specs/api/README.md`).

| Requirement | Missing from the contract |
| --- | --- |
| FR-CAT-009 | Administrative operations for places (list all, create, update). Only the public `GET /places` exists; at R1 places are seed / migration data. |
| FR-IAM-015 | Any recovery operation; handled by support ticket at R1. |
| FR-IAM-016 (P2 part) | Email sign-in and link/unlink operations. |
| FR-IAM-011 / FR-ADM-008 | A change-password operation, although `CreateStaffRequest.temporaryPassword` says the member must change it at first sign-in. |
| FR-BKG-012 | An operation that moves a booking to `disputed` (see A-17). |
| FR-BKG-014, FR-SUB-011, FR-SUB-013 | Refund, reconciliation and reporting operations (permissions `refunds.process`, `payments.reconcile`, `reports.financial` exist without routes). |
| FR-SUB-012 | Coupon types and operations. |
| FR-NTF-005 | Template and delivery-status operations (permission `notifications.manage` exists without routes). |
| FR-ADM-002 | A single-user detail operation (`GET /admin/users/{id}`); only the list exists. |
| FR-ADM-011 | An admin health view; only the public `/health/*` endpoints exist. |
| FR-DSC-010 | `DriverSearchQuery` has no destination, date, time or trip-type fields; those are carried client-side into `CreateRideRequest`. |
