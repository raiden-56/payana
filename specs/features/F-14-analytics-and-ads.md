# F-14 — Analytics and ads settings (GA4, Google Ads, AdSense, consent)

| | |
| --- | --- |
| Requirements | FR-ANL-001 … FR-ANL-012; NFR-PRIV-004, -005; NFR-COMP-005 |
| Priority / release | P0 (FR-ANL-003, 011 P1; FR-ANL-012 P2) · R1 |
| Source | Owner direction of 2026-11-10: *"add google analytics and google ads settings, you make ready I will add account later"* |
| Contract | `config.ts` (`AnalyticsSettings`, `EMPTY_ANALYTICS_SETTINGS`, `ConversionEvent`, `GA4_MEASUREMENT_ID_PATTERN`, `GOOGLE_ADS_ID_PATTERN`, `GOOGLE_ADS_CONVERSION_LABEL_PATTERN`, `ADSENSE_PUBLISHER_ID_PATTERN`, `ADSENSE_SLOT_ID_PATTERN`, `PublicConfig`, `PlatformSettings`), `identity.ts` (`ConsentPreferences`), `commerce.ts` (`AdPlacement`); `ApiRoutes.public.config`, `ApiRoutes.admin.settings`, `ApiRoutes.me.consents` |
| API module | `platform` (settings, public config) |
| Web | `core/config`, `core/analytics`, consent banner in the shell, `features/admin` (Settings → Analytics & Ads), `ui` AdSlot |
| ADR | 0014 analytics via gtag with Consent Mode v2 and run-time configuration |

## 1. Business objective and scope

Everything needed to measure the product and its advertising is built and
switched **off**. The owner turns each integration on later by pasting an
identifier — no code change, no rebuild — and visitors are measured only with
their consent.

**In scope** — run-time configuration of GA4, Google Ads conversion tracking
and AdSense; the loader; Google Consent Mode v2; the consent banner and its
link to account consent; page views; the event taxonomy; conversions; the
admin settings form; the static fallback file; the owner's procedure.
**Out of scope** — Google Tag Manager containers; server-side tagging;
enhanced conversions (they need hashed personal data — excluded by FR-ANL-008);
remarketing audiences configuration (done in Google's consoles); any other
vendor.

"Google Ads settings" is read as **both** conversion tracking (`AW-…`) and
optional AdSense display ads (`ca-pub-…`) — assumption A-19 / decision D-07.

## 2. User stories and acceptance criteria

- **US-01** As the owner I paste my IDs into a form later and tracking starts.
- **US-02** As the owner, until I do, the site talks to Google not at all.
- **US-03** As a visitor I choose analytics and advertising separately, and
  can change my mind.
- **US-04** As the owner I see which pages and steps people use, and which
  ads lead to bookings.
- **US-05** As a user, none of my personal details are sent to Google.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F14-01 | every identifier empty (the shipped default, `EMPTY_ANALYTICS_SETTINGS`) | any page is loaded and used, with or without consent | zero network requests to any Google origin; no `gtag`/`dataLayer`/`adsbygoogle` global exists; no analytics or advertising cookie is set; **no consent banner is shown** (there is nothing to consent to) |
| AC-F14-02 | `ga4MeasurementId` set, `requireConsent: true`, visitor has not decided | the page loads | the consent banner is shown; still zero requests to Google origins; no Google cookie |
| AC-F14-03 | the same | the visitor chooses *Accept all* | Consent Mode defaults (all denied) are pushed first, then an update granting `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`; `gtag.js` is requested once from `https://www.googletagmanager.com/gtag/js?id=…`; GA4 is configured with `send_page_view: false`; the current page view is sent |
| AC-F14-04 | the same | the visitor chooses *Reject all* | no request to Google origins now or on later navigations; the decision is remembered; the banner does not reappear until the re-prompt period ends |
| AC-F14-05 | GA4 and Google Ads both configured | the visitor grants analytics only | GA4 is configured and receives events; the `AW-…` tag is **not** configured and no `conversion` event is sent; the three advertising signals remain `denied` |
| AC-F14-06 | consent previously granted | the visitor withdraws it (banner link in the footer, or Account → Privacy) | a Consent Mode update sets the withdrawn signals to `denied` immediately; no further events are sent to that destination in this session; first-party cookies `_ga*` / `_gcl*` are deleted best-effort; after reload the script is not requested if nothing remains granted |
| AC-F14-07 | `requireConsent: false` | the page loads | configured tags load at start-up with signals granted and no banner; the admin form shows a warning that this is lawful only where consent is not required |
| AC-F14-08 | GA4 active | the router completes a navigation | exactly one `page_view` is sent with `page_path` and `page_location` built from the **route template** (`/requests/:id`, never the real ID), the document title, and no query string except allow-listed keys |
| AC-F14-09 | GA4 active | each moment in §6 happens | the listed event is sent once with exactly the listed parameters |
| AC-F14-10 | any event or page view | its payload is inspected | it contains no phone number, name, email, account/booking/request UUID, coordinates, address, free text or document data (automated payload scan in tests) |
| AC-F14-11 | `googleAdsId` set, advertising consent granted, a label configured for `booking_confirmed` | a quote is accepted | one `conversion` event is sent with `send_to: "<googleAdsId>/<label>"`, `value` = booking fee in rupees, `currency: "INR"`; repeating the view of that booking sends nothing more |
| AC-F14-12 | a `ConversionEvent` with no label, or advertising consent denied | that moment happens | no `conversion` event; the GA4 event (if analytics is granted) is unaffected |
| AC-F14-13 | a `super_admin` on Admin → Settings → Analytics & Ads | enters `G-AB12CD34EF`, `AW-1234567890`, labels, and saves | `PUT /admin/settings` → `200 PlatformSettings`; within 60 s `GET /public/config` returns the values; audit `settings.updated` lists the changed keys |
| AC-F14-14 | the same form | a value fails its pattern (`g-123`, `UA-12345-1`, `AW123`, `pub-123`, a label with spaces) | the field shows a specific message with an example; the server independently returns `400 validation_failed` with the field path; nothing is saved |
| AC-F14-15 | an administrator with `settings.read` only (`marketing_manager`) | opens the page / tries to save | values are visible read-only; `PUT` → `403 forbidden`. Roles without `settings.read` → `403` on `GET` and no navigation item |
| AC-F14-16 | the API unreachable at start-up | the client starts | it reads the static fallback file and applies its `analytics` values; when the API later responds, a non-empty API identifier replaces the fallback on the next start |
| AC-F14-17 | a signed-in user whose `ConsentPreferences.updatedAt` is non-null | they sign in on a new device | the server values are applied to Consent Mode without showing the banner; changing the banner choice calls `PUT /me/consents`; a banner choice made before sign-in is pushed to the server when the server has none |
| AC-F14-18 | `adsensePublisherId` and the slot for `home_strip` set, advertising consent granted, **no** eligible local campaign for that placement | the placement renders | the AdSense script is requested once and one responsive unit is rendered, labelled "Advertisement"; if any condition is false, nothing is requested and nothing is rendered |
| AC-F14-19 | `debugMode: true` | events are sent | each carries `debug_mode: true` (GA4 DebugView); the admin form flags that debug mode is on |
| AC-F14-20 | a browser extension blocks Google origins, or the script fails to load | the app is used | no error is shown, no functionality is lost, no retry loop occurs |
| AC-F14-21 | the consent banner | displayed | *Accept all* and *Reject all* have equal visual weight; *Choose* reveals two labelled switches (Analytics, Advertising) defaulting to off; the banner is reachable and operable by keyboard, does not trap focus and does not cover the primary action on a 320 px screen |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | **Empty means off.** An integration with an empty identifier requests nothing, defines no globals and sets no cookies. |
| BR-02 | Identifiers are public values (they appear in page source on any site that uses them). They are not secrets and are never placed in the secret store. |
| BR-03 | Configuration source order per field: a non-empty value from `GET /public/config` wins; otherwise the static fallback file's value; otherwise empty. `requireConsent` is true if **either** source says true. |
| BR-04 | Consent Mode v2 signals: `analytics_storage` ← analytics choice; `ad_storage`, `ad_user_data`, `ad_personalization` ← advertising choice; `security_storage` granted; everything else denied. Defaults are always pushed before any other `gtag` call. |
| BR-05 | With `requireConsent: true` the Google script is **not requested at all** until at least one category is granted (constitution §2.7 — stricter than Consent Mode's cookieless pings). |
| BR-06 | A destination is configured only when its identifier is set **and** its category is granted: GA4 ↔ analytics; Google Ads ↔ advertising; AdSense ↔ advertising. |
| BR-07 | Anonymous choice is stored on the device (`payana.consent.v1`: `analytics`, `advertising`, `decidedAt`, `version`). It is re-requested after 12 months ◊ or when the consent text `version` changes. |
| BR-08 | For signed-in users `ConsentPreferences` on the server is the source of truth (AC-17). `marketingMessages` is not part of the banner. |
| BR-09 | Page paths are route templates; allow-listed query keys are `region`, `category`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `gbraid`, `wbraid`. Search coordinates are never placed in the URL. |
| BR-10 | No `user_id`, no user properties derived from identity, no enhanced conversions. The only user-scoped dimension is `account_type` ∈ `anonymous` \| `customer` \| `driver` \| `admin`. |
| BR-11 | Administrator screens (`/admin/**`) send no page views or events. |
| BR-12 | Each conversion fires at most once per underlying entity (request, booking, invoice, account), de-duplicated in session storage by a non-identifying hash. |
| BR-13 | `value` on conversions and purchases is **platform revenue** (booking fee, plan price) in rupees — never the trip fare, which is not the platform's money. |
| BR-14 | AdSense is backfill behind local ads (F-12 BR-04) and renders only in the four `AdPlacement` positions. |
| BR-15 | Analytics is a platform adapter (`core/analytics`): feature code calls `analytics.track(name, params)` with typed names; nothing outside the adapter references `gtag`. A no-op adapter is used in tests, SSR-less prerender and native shells until a native SDK is chosen. |
| BR-16 | Changing settings never requires a deployment; it propagates through `/public/config` (≤ 60 s cache). |

## 4. Workflows

**Start-up** — load `PublicConfig` (3 s timeout ◊) → merge with the fallback
file (BR-03) → resolve consent (stored choice or server preferences) →
if any integration is configured **and** consent is required **and**
undecided: show the banner → when permitted: push defaults, push update,
inject script, configure destinations, send the pending page view.

**Owner adds accounts** — §13.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Identifier removed later | On next start nothing loads; stored consent is kept for when it returns |
| ALT-2 | Identifier changed while a tab is open | Applies on next start (no hot swap of destinations) |
| ALT-3 | Consent decided, then a new integration is configured | No re-prompt if its category was already decided; the stored decision applies |
| ALT-4 | Script blocked | Adapter stays in no-op mode (AC-20) |
| ALT-5 | Both config sources unreachable | `EMPTY_ANALYTICS_SETTINGS`: everything off |
| ALT-6 | Native shell (later) | Web tags are not used in the WebView; native adapter replaces it (ADR-0007) |

## 5. Loading, empty, error, retry and offline states

| Surface | Loading | Empty | Error | Retry | Offline |
| --- | --- | --- | --- | --- | --- |
| Loader | Never blocks rendering; injected `async` after first paint | Off (BR-01) | Silent no-op | None | Events are dropped, not queued (no background replay of user activity) |
| Consent banner | Appears after first paint without shifting layout (fixed, bottom) | Not shown when nothing is configured | — | — | Works offline (local decision); server sync on reconnect |
| Admin settings form | Skeleton | Fields empty with "Off — add an ID to switch on" helper text and an example per field | Field errors; save failure banner with *Try again* | Manual | Read-only with offline notice |
| AdSense slot | Collapsed until filled | Collapsed | Collapsed | None | Collapsed |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /public/config` | — → `PublicConfig` (includes `analytics`) | public |
| `GET /admin/settings` | — → `PlatformSettings` | `settings.read` |
| `PUT /admin/settings` | `PlatformSettingsUpdate` → `PlatformSettings` | `settings.manage` |
| `GET` · `PUT /me/consents` | — / `ConsentPreferencesInput` → `ConsentPreferences` | user (F-02) |

Storage: `platform_settings` row `analytics` (JSON of `AnalyticsSettings`).
Static fallback (web): `apps/web/public/app-config.json` ◊ with at least an
`analytics` member of the same shape, shipped with every identifier empty.

### Event taxonomy (FR-ANL-007)

All parameters are low-cardinality codes, booleans or bucketed numbers.

| Event | When | Parameters | Google Ads conversion |
| --- | --- | --- | --- |
| `page_view` | Navigation end | `page_path` (template), `page_location`, `page_title`, `account_type` | — |
| `driver_search` | Search results shown | `region`, `category`, `radius_km`, `has_location`, `results_bucket` (0 / 1-5 / 6-20 / 20+) | — |
| `view_driver_profile` | Profile opened | `region`, `category`, `is_verified`, `is_featured` | — |
| `fare_estimate_viewed` | Estimate displayed | `region`, `category`, `trip_type` | — |
| `login` | Sign-in succeeded | `method` (`phone_otp`) | — |
| `sign_up` | First sign-in of a new account | `method`, `role` (`customer` \| `driver`) | `customer_sign_up` / `driver_sign_up` |
| `ride_request_submitted` | Request created | `trip_type`, `region`, `category`, `passengers_bucket`, `has_package`, `is_direct` | `ride_requested` |
| `first_quote_received` | First quote seen on a request | `trip_type`, `seconds_bucket` | — |
| `booking_confirmed` | Quote accepted | `trip_type`, `region`, `category`, `quotes_bucket`, `value`, `currency` | `booking_confirmed` |
| `booking_cancelled` | Customer or driver cancels | `by`, `reason`, `trip_type` | — |
| `review_submitted` | Review posted | `rating` | — |
| `package_viewed` | Package detail opened | `package` (slug), `region` | — |
| `partner_onboarding_step` | Step completed | `step` (`profile` \| `vehicle` \| `documents` \| `submitted`) | — |
| `plans_viewed` | Plans page opened | `account_type` | — |
| `begin_checkout` | Plan confirm sheet opened | `plan` (code), `value`, `currency` | — |
| `purchase` | Checkout completed | `transaction_id` (invoice number), `plan`, `value`, `currency` | `subscription_purchased` |
| `local_ad_impression` / `local_ad_click` | F-12 events | `campaign` (ID), `placement`, `region` | — |
| `consent_updated` | Choice saved (only if analytics is then granted) | `analytics`, `advertising` | — |
| `pwa_installed` | `appinstalled` | — | — |
| `web_vitals` | LCP / INP / CLS reported | `metric`, `value`, `rating`, `reduced_motion` | — |
| `exception` | Unhandled client error | `code` (class of error), `fatal` | — |

## 7. Authorisation and security

- Reading settings needs `settings.read` (`super_admin`, `marketing_manager`);
  writing needs `settings.manage` (`super_admin` only). Both are audited.
- Identifiers are validated on client and server with the contract's
  patterns, so a pasted value cannot inject script or an arbitrary URL: the
  loader builds script URLs only from validated identifiers and fixed origins.
- CSP allow-lists exactly the origins this feature can load (Google tag,
  Analytics collection, Ads, AdSense). Because identifiers are run-time
  configuration, the allow-list is static; the *client* decides whether to
  request anything (BR-01, BR-05).
- No third party other than Google is contacted. No fingerprinting, no
  session replay.
- Privacy threats covered: tags firing before consent (AC-02, AC-04), PII in
  URLs and events (BR-09, BR-10, AC-10), admin pages leaking operational data
  (BR-11).

## 8. Validation rules

| Field | Rule (empty string always valid = off) |
| --- | --- |
| `ga4MeasurementId` | trimmed, upper-cased, matches `GA4_MEASUREMENT_ID_PATTERN` (`G-` + 6–14 of A–Z, 0–9). `UA-…` Universal Analytics IDs are rejected with an explanatory message |
| `googleAdsId` | trimmed, upper-cased prefix, matches `GOOGLE_ADS_ID_PATTERN` (`AW-` + 8–12 digits) |
| `googleAdsConversionLabels[event]` | key ∈ `ConversionEvent`; value matches `GOOGLE_ADS_CONVERSION_LABEL_PATTERN`; a pasted `AW-123/AbCdEf` is split and only the label kept; labels require `googleAdsId` to be set |
| `adsensePublisherId` | lower-cased, matches `ADSENSE_PUBLISHER_ID_PATTERN` (`ca-pub-` + 10–20 digits); a pasted `pub-…` gets the `ca-` prefix suggested |
| `adsenseSlots[placement]` | key ∈ `AdPlacement`; value matches `ADSENSE_SLOT_ID_PATTERN`; slots require `adsensePublisherId` |
| `requireConsent` | boolean; switching to false requires typing a confirmation and is audited |
| `debugMode` | boolean; cannot be true when `environment` is `production` for longer than 24 h ◊ (auto-reverts, audited) |
| Unknown keys | rejected (`400 validation_failed`) |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F14-01 | Unit | Config merge (BR-03) across API / fallback / empty combinations |
| UT-F14-02 | Unit | Loader decision table: identifiers × `requireConsent` × consent state → which script and destinations |
| UT-F14-03 | Unit | Consent Mode command order: defaults always precede updates and `config` |
| UT-F14-04 | Unit | Page-path sanitiser: UUIDs → template, query allow-list, no coordinates |
| UT-F14-05 | Unit | Event builder: every event's parameter set matches §6; PII scanner rejects phone-, email-, UUID- and coordinate-shaped values |
| UT-F14-06 | Unit | Conversion mapping and once-only de-duplication |
| UT-F14-07 | Unit | Field validators and paste normalisation against the five contract patterns |
| UT-F14-08 | Unit | Consent store: anonymous persistence, re-prompt after expiry/version change, sign-in reconciliation |
| IT-F14-01 | Integration | `PUT /admin/settings` validation per field; audit entry; `GET /public/config` reflects within the cache window (AC-13, 14) |
| IT-F14-02 | Integration | Permission matrix on settings (AC-15) |
| E2E-F14-01 | E2E | Empty identifiers: network log contains no Google origin; no banner (AC-01) |
| E2E-F14-02 | E2E | Configured + undecided / reject: no Google request (AC-02, 04) — Google origins are intercepted by the test, never actually called |
| E2E-F14-03 | E2E | Accept all: intercepted `gtag.js` request once; `dataLayer` shows defaults → update → config → `page_view` in order (AC-03) |
| E2E-F14-04 | E2E | Analytics-only consent: no `AW-` config, no conversion (AC-05) |
| E2E-F14-05 | E2E | Navigation produces one template-pathed `page_view` each (AC-08) |
| E2E-F14-06 | E2E | Full booking journey: taxonomy events and the `booking_confirmed` conversion appear once (AC-09, 11) |
| E2E-F14-07 | E2E | Withdraw consent: update pushed, events stop, cookies cleared (AC-06) |
| E2E-F14-08 | E2E | AdSense backfill conditions (AC-18) |
| E2E-F14-09 | E2E | Banner accessibility and 320 px layout (AC-21) |
| NT-F14-01 | Negative | Blocked script: no errors, app works (AC-20) |
| NT-F14-02 | Negative | Malformed identifiers via direct API call are rejected (AC-14) |
| NT-F14-03 | Negative | `/admin/**` navigation emits nothing (BR-11) |

## 10. Performance and accessibility

- The loader adds ≤ 3 kB gzip to the initial bundle; third-party script is
  requested only after consent and after first paint, `async`; it must not
  move LCP by more than 100 ms on the reference device when enabled.
- AdSense units have reserved aspect ratios only when a fill is expected, to
  hold CLS within NFR-PERF-003.
- Banner: `role="region"` with an accessible name, not a modal; controls are
  buttons and switches with labels and descriptions; the choice is announced;
  the footer has a persistent *Privacy choices* link to reopen it.

## 11. Deployment, rollback and observability

- **Ships off.** Seeded `platform_settings.analytics` =
  `EMPTY_ANALYTICS_SETTINGS`; fallback file has empty identifiers.
- **Turning on** is a data change by a `super_admin`; **turning off** is
  clearing the field (effective ≤ 60 s for new page loads). That is also the
  rollback.
- **CSP**: Google origins are in the allow-list from the first release so
  that enabling needs no deployment; a report-only period precedes
  enforcement.
- **Observability**: audit `settings.updated`; client debug panel (non-
  production, or `debugMode`) lists each integration as Off / Waiting for
  consent / Active / Blocked; server metric for settings changes.
- **Launch checklist items**: privacy notice names Google as a processor and
  lists cookies; `requireConsent` is true; debug mode off; GA4 data
  retention set by the owner in GA4; Ads–Analytics link made in Google's
  consoles.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | `AuthSession` has no "new account" indicator; `sign_up` is inferred from `me.createdAt` being within 2 minutes ◊ of sign-in. |
| G-2 | `AnalyticsSettings` has no field for a consent text version or re-prompt period; both are client constants. |
| G-3 | No server-side record of an **anonymous** visitor's consent (device-only). Proof of consent exists only for signed-in users (audit `consent.updated`). |
| G-4 | `ads.txt` (FR-ANL-012) must be served from the web origin; nothing in the contract or infrastructure definition produces it from `adsensePublisherId`. |
| G-5 | No Google Tag Manager support by design (ADR-0014). |
| A-1 | The fallback file path, the config timeout, the re-prompt period and the debug auto-revert are defaults. |
| A-2 | "Google Ads" = conversion tracking + optional AdSense (A-19). |
| A-3 | Local ads show without advertising consent (contextual); AdSense never does. |

## 13. Owner's procedure — "how to add your accounts later"

Nothing below needs a developer. You need a `super_admin` sign-in.

**A. Google Analytics 4**

1. In Google Analytics create an account and a **GA4 property**.
2. Admin → Data streams → Add stream → **Web**; enter the site address.
3. Copy the **Measurement ID** — it looks like `G-AB12CD34EF`.
4. In Payana: Admin → Settings → Analytics & Ads → *Google Analytics
   measurement ID* → paste → Save.

**B. Google Ads conversion tracking**

1. In Google Ads: Goals → Conversions → New conversion action → **Website**.
2. Create one action for each moment you want to count. Payana supports five:

   | Payana event (`ConversionEvent`) | Suggested Google Ads category |
   | --- | --- |
   | `customer_sign_up` | Sign-up |
   | `ride_requested` | Submit lead form |
   | `booking_confirmed` | Book appointment / Purchase |
   | `driver_sign_up` | Sign-up |
   | `subscription_purchased` | Purchase |

3. Choose "Install the tag yourself" and open the **event snippet**. It
   contains `send_to: 'AW-1234567890/AbC-D_efG123'`.
   The part before the slash is your **tag ID** (`AW-1234567890`); the part
   after is that action's **conversion label**.
4. In Payana paste the tag ID once and each label next to its event. Events
   without a label are simply not reported to Google Ads. Save.

**C. Google AdSense (optional — decision D-07)**

1. Get the site approved in AdSense. Copy the **publisher ID**
   (`ca-pub-1234567890123456`).
2. Create a **display ad unit** for each position you want to fill; copy each
   unit's **slot ID** (the digits in `data-ad-slot`).
3. Paste the publisher ID and the slot IDs next to their positions (Home
   strip, Search results, Booking confirmation, Package page). Positions
   without a slot ID show no Google ads. Local advertisers' campaigns always
   take priority.
4. Ask your developer to publish the `ads.txt` line AdSense gives you
   (gap G-4).

**D. Check it works**

1. Turn on *Debug mode*, save, wait one minute.
2. Open the site in a private window → *Accept all* in the consent banner.
3. In GA4 open Admin → DebugView (or Reports → Realtime): you should see
   `page_view` events as you move around.
4. Use Google Tag Assistant to confirm the Ads tag is detected and consent
   signals are "granted".
5. Turn *Debug mode* off again.

**E. Keep it lawful**

- Leave *Require consent* **on**.
- Update the privacy notice to name Google and these purposes before you
  switch anything on (decision D-03 — needs legal review).
- To stop all measurement at once, clear the identifiers and save.

**Without the admin screen** (API not deployed yet): edit
`apps/web/public/app-config.json`, fill the same fields, and redeploy the web
app.
