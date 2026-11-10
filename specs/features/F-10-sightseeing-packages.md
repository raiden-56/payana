# F-10 — Sightseeing packages

| | |
| --- | --- |
| Requirements | FR-PKG-001 … FR-PKG-005 |
| Priority / release | P1 · R1 |
| Contract | `commerce.ts` (`TourPackage`, `TourPackageInput`, `PackageStop`, `PackageArtwork`); `ApiRoutes.packages.*`, `ApiRoutes.admin.{packages, package}` |
| API module | `apps/api/src/modules/commerce` |
| Web | `features/packages`, entry from `features/home`; admin in `features/admin` |
| Flag | `FeatureFlag.Packages` |

## 1. Business objective and scope

Visitors do not know the circuit — Om Beach, Kudle, Mahabaleshwar temple,
Yana rocks, Mirjan fort, Murudeshwar. A package describes a sensible day so a
customer can ask for it in one tap and drivers can quote a like-for-like
price.

**In scope** — public list and detail; starting a sightseeing request from a
package; admin maintenance; the feature flag.
**Out of scope** — fixed-price packages, tickets/entry fees, guides, hotel
bundles, multi-day itineraries with stays.

A package is **content plus a request template**. It has no fixed price and
is not sold by the platform.

## 2. User stories and acceptance criteria

- **US-01** As a visitor I browse day trips for the town I am in.
- **US-02** I see the stops, how long it takes, and roughly what a vehicle
  costs.
- **US-03** I request the package for a date and get quotes.
- **US-04** As marketing I add and reorder packages without a release.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F10-01 | active and inactive packages in two regions | `GET /packages?regionSlug=gokarna` | `200 TourPackage[]` — active packages of that region only, ordered by `sortOrder`; without `regionSlug`, active packages of all `live` regions |
| AC-F10-02 | an active package | `GET /packages/{slug}` | `200 TourPackage` with `stops` (name, description, `durationMinutes`), `highlights`, `durationHours`, `distanceKm`, `priceFrom[]` per category, `bestTime`, `artwork` |
| AC-F10-03 | an inactive or unknown slug | `GET /packages/{slug}` | `404 not_found` |
| AC-F10-04 | `FeatureFlag.Packages` off | list / detail / sightseeing request | list returns `[]`; detail `404`; `POST /ride-requests` with `tripType: "sightseeing"` and a `packageId` → `403 feature_disabled`; the web client hides package entry points |
| AC-F10-05 | a package detail page | the customer taps *Request this trip* | the request form opens with `tripType: "sightseeing"`, `packageId` set, the category defaulted to the cheapest `priceFrom` entry that seats the party, and only pickup, date/time and passengers left to fill (F-07) |
| AC-F10-06 | a sightseeing request tied to a package | drivers view it and the booking is created | `DriverRequestFeedItem.packageTitle`, `RideRequest.packageTitle` and `Booking.packageTitle` carry the title **as it was when requested**, even if the package is later renamed or deactivated |
| AC-F10-07 | an admin with `packages.manage` | `POST /admin/packages` with a valid `TourPackageInput` | `201 TourPackage`; duplicate `slug` → `409 conflict`; audit `package.created` |
| AC-F10-08 | the same admin | `PUT /admin/packages/{id}` setting `isActive: false` | it leaves the public list within the cache window; open requests and bookings referencing it are unaffected |
| AC-F10-09 | an admin | `GET /admin/packages` | every package including inactive |
| AC-F10-10 | an admin without `packages.manage` (e.g. `support_agent`) | any `/admin/packages*` route | `403 forbidden` |
| AC-F10-11 | a `priceFrom` entry | the page renders it | the amount is labelled "from … · indicative, drivers quote the final price" |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | A package belongs to one region (`regionSlug`) — where the trip starts. Stops may lie outside it. |
| BR-02 | `priceFrom` is indicative marketing data entered by the administrator per category; it is never used in fare computation and never shown without the "indicative" label (constitution §2.8). |
| BR-03 | `artwork` selects one of the client's vector illustrations (`PackageArtwork`); packages carry no uploaded images at R1. |
| BR-04 | `slug` is unique and immutable after creation (URLs, analytics). |
| BR-05 | `durationHours` should be consistent with the stops: `Σ stops.durationMinutes ≤ durationHours × 60`; the admin form warns, the API rejects if stops alone exceed the duration. |
| BR-06 | Requests copy `packageTitle` at creation (AC-06). |
| BR-07 | Only packages in `live` regions are listed publicly. |

## 4. Workflows

**Primary** — Home "Day trips" strip or `/packages` → region tabs → cards
(artwork, title, duration, distance, "from ₹…") → detail (stop timeline drawn
as a vertical route with scroll-linked progress, highlights, best time, price
table) → *Request this trip* → F-07.

**Admin** — list → create/edit form (stops as a reorderable list) → preview →
save → activate.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Party larger than any `priceFrom` category | Category chooser shows all categories; a note suggests two vehicles |
| ALT-2 | Customer wants a custom tour | *Plan your own* opens a sightseeing request without `packageId` (drop required) |
| ALT-3 | Package deactivated while a customer is on the page | *Request* returns `404` → message + link to other packages |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Card skeletons with the artwork placeholder; detail skeleton |
| Empty | "Day trips for this town are coming soon" + link to request a custom tour |
| Error | Error panel with *Try again* |
| Retry | Manual; list is cached stale-while-revalidate by the service worker |
| Offline | Cached list and visited details readable; *Request* disabled with the offline message |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /packages` | `?regionSlug` → `TourPackage[]` | public |
| `GET /packages/{slug}` | — → `TourPackage` | public |
| `GET` · `POST /admin/packages` | — / `TourPackageInput` → `TourPackage[]` / `TourPackage` | `packages.manage` |
| `PUT /admin/packages/{packageId}` | `TourPackageInput` → `TourPackage` | `packages.manage` |

Table: `tour_packages` (unique `slug`; index `(region_id, is_active,
sort_order)`). `ride_requests.package_id` + `package_title` snapshot.

## 7. Authorisation and security

- Public reads, cacheable, rate-limited.
- Admin writes need `packages.manage` (`super_admin`, `marketing_manager`);
  audited. All text fields are plain text, escaped on render; no HTML or
  Markdown is accepted.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `slug` | `^[a-z0-9][a-z0-9-]{2,59}$`, unique, immutable |
| `title` | 3–80 chars |
| `summary` | 10–300 chars |
| `regionSlug` | existing region |
| `artwork` | `PackageArtwork` |
| `durationHours` | 1–24 (one decimal allowed) |
| `distanceKm` | 1–600 |
| `stops` | 1–12 items; `name` 1–60; `description` ≤ 200; `durationMinutes` 5–480 |
| `highlights` | 0–8 items of 1–80 chars |
| `priceFrom` | 1–6 entries; `categoryCode` active and unique within the list; `price.amountMinor` > 0, INR |
| `bestTime` | ≤ 80 chars |
| `sortOrder` | 0–999 |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F10-01 | Unit | Duration vs. stops consistency rule |
| UT-F10-02 | Unit (web) | Default category selection from `priceFrom` and party size |
| IT-F10-01 | Integration | Public list filters and ordering; detail; inactive → 404 (AC-01…03) |
| IT-F10-02 | Integration | Flag off behaviour across list, detail and request (AC-04) |
| IT-F10-03 | Integration | Title snapshot survives rename/deactivation (AC-06) |
| IT-F10-04 | Integration | Admin create / update / list, conflicts (AC-07…09) |
| E2E-F10-01 | E2E | Browse → detail → request pre-filled → request created as `sightseeing` |
| NT-F10-01 | Negative | Permission matrix on admin routes (AC-10) |
| NT-F10-02 | Negative | Bad slug, empty stops, unknown category in `priceFrom` |

## 10. Performance and accessibility

- List ≤ 10 kB gzip; artwork is inline SVG reused via `<use>` so cards add no
  image requests; detail LCP element is text.
- The stop timeline is an ordered list; the scroll-linked route drawing is
  decorative (`aria-hidden`) and static under reduced motion.
- Price table has header cells; "from" and "indicative" are text.

## 11. Deployment, rollback and observability

- **Seed**: illustrative Gokarna packages (beach circuit, temple trail, Yana
  and Vibhuti falls, Mirjan fort and Murudeshwar) to be reviewed by the owner
  for accuracy before launch.
- **Flag**: `FeatureFlag.Packages`. **Rollback**: flag off.
- **Metrics**: package views; view → request conversion; requests per package.
- **Audit**: `package.created|updated`.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | `TourPackage` has no image fields; artwork is a fixed set of six. |
| G-2 | `TourPackage.stops` have no coordinates, so distance to stops and route display rely on `distanceKm` entered by the admin. |
| G-3 | No localisation fields (Kannada titles) on packages. |
| A-1 | Packages are a request template, not a priced product. |
| A-2 | Seeded place names and durations are editorial placeholders. |
