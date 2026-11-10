# F-03 — Catalogue: regions, vehicle categories, places, public configuration

| | |
| --- | --- |
| Requirements | FR-CAT-001 … FR-CAT-009 |
| Priority / release | P0 (public reads, region-as-data); P1 (admin management) · R1 |
| Contract | `catalog.ts` (`Region`, `RegionInput`, `VehicleCategory`, `VehicleCategoryInput`, `CategoryPricing`, `FareEstimate`, `PlaceSuggestion`, `PlaceSearchQuery`, `PlaceKind`), `config.ts` (`PublicConfig`); `ApiRoutes.catalog.*`, `ApiRoutes.public.config`, `ApiRoutes.admin.regions*`, `ApiRoutes.admin.vehicleCategories*` |
| API modules | `catalog`, `platform` (public config) |
| Web | `core/config`, `core/api`, consumers in `features/home`, `explore`, `booking` |
| ADRs | 0015 map provider deferred · 0017 money as minor units |

## 1. Business objective and scope

Hold everything that differs between towns and vehicle types as data, so the
product launches in Gokarna and opens Kumta, Honnavar, Murudeshwar and Karwar
by editing rows.

**In scope** — regions; vehicle categories with pricing rules; the fare
estimate; curated pickup/drop places; the public configuration document;
admin maintenance of regions and categories.
**Out of scope** — settings editing (F-16 / F-14); packages (F-10); a
geocoder or map tiles (ADR-0015).

## 2. User stories and acceptance criteria

- **US-01** As a visitor I see which towns are served and which are coming.
- **US-02** As a customer I pick a vehicle type and see what it roughly costs.
- **US-03** As a customer I pick "Gokarna Bus Stand" or "Om Beach" without
  typing an address.
- **US-04** As the owner I open a new town without a release.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F03-01 | seeded regions (Gokarna `live`; Kumta, Honnavar, Murudeshwar, Karwar `coming_soon`; one `hidden`) | `GET /regions` | `200 Region[]` containing the `live` and `coming_soon` regions only, each with `slug`, `name`, `nameLocal`, `center`, `radiusKm`, `status`, `tagline` |
| AC-F03-02 | active and inactive categories | `GET /vehicle-categories` | only `isActive` categories, ordered by `sortOrder`, each with `pricing` in minor units and an `icon` from `VehicleIcon` |
| AC-F03-03 | two points 12 km apart and category `auto` | `GET /fare-estimate?fromLat&fromLng&toLat&toLng&categoryCode=auto` | `200 FareEstimate` with `low.amountMinor < high.amountMinor`, `distanceKm`, `durationMinutes`, `basis: "straight_line"` |
| AC-F03-04 | an unknown or inactive `categoryCode` | fare estimate | `404 not_found` |
| AC-F03-05 | curated places in Gokarna and an airport place whose region is not a live market | `GET /places?regionSlug=gokarna` | `200 PlaceSuggestion[]` for that region ordered by `sortOrder` then label, at most 30; inactive places are absent |
| AC-F03-06 | the same data | `GET /places?q=beach` | case-insensitive label matches across regions; `GET /places?limit=500` → `400 validation_failed` (max 100) |
| AC-F03-07 | no parameters | `GET /places` | up to 30 active places, default region's first |
| AC-F03-08 | any caller | `GET /public/config` | `200 PublicConfig` with `appName`, `environment`, `analytics`, `features` (all `FeatureFlag` keys present), `support`, `bookingFee`, `defaultRegionSlug`; `Cache-Control: public, max-age ≤ 60`; contains no secret |
| AC-F03-09 | an admin with `catalog.manage` | `PUT /admin/regions/{id}` sets Kumta to `live` | `200 Region`; within 60 s `GET /regions` shows it `live`, search and ride requests with a Kumta pickup are accepted; no deployment occurs; audit `region.updated` |
| AC-F03-10 | an admin with `catalog.manage` | `POST /admin/vehicle-categories` with `minPerKm > maxPerKm`, or a duplicate `code` | `400 validation_failed` / `409 conflict` |
| AC-F03-11 | an admin with `catalog.manage` | lowers a category's `maxPerKm` below rates some vehicles already publish | the change is saved; affected vehicles' rates are flagged for the owner and clamped in search output to the new bounds (BR-06) |
| AC-F03-12 | an admin **without** `catalog.manage`, or a non-admin | any `/admin/regions*` or `/admin/vehicle-categories*` route | `403 forbidden` |
| AC-F03-13 | `GET /regions`, `/vehicle-categories`, `/places` responses | the same request repeats with `If-None-Match` | `304 Not Modified` |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | A point belongs to the nearest region whose `center` is within `radiusKm`; if none, it has no region (`Place.regionSlug` absent). |
| BR-02 | `live` regions accept searches, requests and availability. `coming_soon` regions are listed and accept partner pre-registration only (FR-PRT-017). `hidden` regions are invisible to the public. |
| BR-03 | Region `slug` and category `code` are immutable after creation (they appear in URLs, analytics and partner data). |
| BR-04 | Category pricing invariants: all amounts ≥ 0, currency INR, `minPerKm ≤ perKm ≤ maxPerKm`. |
| BR-05 | Fare estimate ◊: `distanceKm = haversine × 1.3` (road factor); `durationMinutes = distanceKm / 30 km/h × 60`; `mid = baseFare + perKm × distanceKm`; `low = 0.85 × mid`, `high = 1.25 × mid`, both rounded to ₹10. Always labelled "estimate" in the UI (constitution §2.8). |
| BR-06 | Deactivating a category hides it from new requests and search; existing vehicles keep it and are not searchable under it until reactivated. |
| BR-07 | Places are curated reference data: `region_id` nullable (an out-of-region endpoint such as an airport), label, address, point, `PlaceKind`, `sort_order`, `is_active`. `PlaceSuggestion.regionSlug` may therefore name a region that is not `live`. |
| BR-08 | `GET /places` default limit 30, maximum 100. `q` matches the label case-insensitively (substring). |
| BR-09 | `PublicConfig` is assembled from `platform_settings` plus environment (`appName`, `environment`) and is safe to cache publicly. |
| BR-10 | Nothing in application code names a town, coordinate or price; seed data does (constitution §3 "Region is data"). |

## 4. Workflows

**Primary (client start-up)** — load `PublicConfig` (fallback: static file,
F-14) → load regions and categories (cached by the service worker,
stale-while-revalidate) → pick the region containing the device location, else
`defaultRegionSlug`.

**Primary (admin opens a region)** — create/edit region → set `live` → verify
on the public site (runbook in `deployment/release-plan.md` §9).

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Location denied | Region chooser shown; default region preselected |
| ALT-2 | Device is outside every region | Message "We're not in your area yet" + list of live regions |
| ALT-3 | Estimate between regions (outstation) | Same formula; UI stresses the wide range |
| ALT-4 | No curated place fits | Customer picks the nearest place and describes the exact spot in `notes` (A-16) |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Category chips and region chooser render skeletons; the hero search is usable as soon as config arrives |
| Empty | No live region → "Launching soon" page with coming-soon regions. No places for a region → picker shows only "Use my current location" and saved places |
| Error | Catalogue failure with no cache → full-width error with *Try again*; with cache → cached data plus a discreet "couldn't refresh" note |
| Retry | Automatic retry with back-off (1 s, 3 s, 9 s), then manual |
| Offline | Cached regions, categories and places are used; estimate shows "Estimate needs a connection" |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /regions` | — → `Region[]` | public |
| `GET /vehicle-categories` | — → `VehicleCategory[]` | public |
| `GET /fare-estimate` | query `fromLat, fromLng, toLat, toLng, categoryCode` → `FareEstimate` | public |
| `GET /places` | `PlaceSearchQuery` → `PlaceSuggestion[]` | public |
| `GET /public/config` | — → `PublicConfig` | public |
| `GET` · `POST /admin/regions` | — / `RegionInput` → `Region[]` (all statuses) / `Region` | `catalog.manage` |
| `PUT /admin/regions/{regionId}` | `RegionInput` → `Region` | `catalog.manage` |
| `GET` · `POST /admin/vehicle-categories` | — / `VehicleCategoryInput` → `VehicleCategory[]` (incl. inactive) / `VehicleCategory` | `catalog.manage` |
| `PUT /admin/vehicle-categories/{categoryId}` | `VehicleCategoryInput` → `VehicleCategory` | `catalog.manage` |

Tables: `regions` (GiST on `center`), `vehicle_categories`, `places` (GiST on
`location`, index on `(region_id, sort_order)`), `platform_settings`. Redis:
60 s cache of the assembled catalogue and public config, invalidated on admin
write.

## 7. Authorisation and security

- Public reads are unauthenticated, rate-limited per IP (NFR-SEC-007) and
  cacheable.
- Admin writes require `catalog.manage` (held only by `super_admin`), are
  validated, and are audited (`region.created|updated`,
  `vehicle_category.created|updated`).
- `PublicConfig` is reviewed field by field as public: no keys, no internal
  hostnames, no personal data. The support contact is a business contact.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| Region `slug` | `^[a-z][a-z0-9-]{1,39}$`, unique, immutable |
| Region `name` / `nameLocal` / `state` | 1–60 chars / ≤ 60 / 1–60 |
| `center` | valid `LatLng` |
| `radiusKm` | 1–100 |
| `status` | `RegionStatus` |
| `tagline` | ≤ 140 chars |
| Category `code` | `^[a-z][a-z0-9_]{1,29}$`, unique, immutable |
| `icon` | `VehicleIcon` |
| `seats` / `luggageCapacity` | 1–`MAX_PASSENGERS` / 0–20 |
| `pricing.*.amountMinor` | integer ≥ 0, ≤ 10 000 000; `currency = "INR"`; `minPerKm ≤ perKm ≤ maxPerKm` |
| `sortOrder` | integer 0–999 |
| Fare-estimate coordinates | valid `LatLng`; the two points differ |
| `PlaceSearchQuery.regionSlug` | slug format; unknown slug → empty list |
| `q` | 1–60 chars |
| `limit` | 1–100 |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F03-01 | Unit | Region resolution for a point: inside one, inside two (nearest wins), outside all |
| UT-F03-02 | Unit | Fare estimate formula, rounding, low < high, zero-distance guard |
| UT-F03-03 | Unit | Category pricing invariants |
| IT-F03-01 | Integration | Public lists: status and active filtering, ordering, ETag/304 (AC-01, 02, 13) |
| IT-F03-02 | Integration | Places: region filter, `q`, limits, inactive hidden, out-of-region place (AC-05…07) |
| IT-F03-03 | Integration | Public config shape, cache header, all flag keys present (AC-08) |
| IT-F03-04 | Integration | Admin region lifecycle → public visibility within cache window (AC-09) |
| IT-F03-05 | Integration | Admin category create/update, conflicts (AC-10, 11) |
| E2E-F03-01 | E2E | First visit with location denied: region chooser → categories → estimate |
| NT-F03-01 | Negative | Admin routes as customer, driver, each non-super admin role (AC-12) |
| NT-F03-02 | Negative | Malformed coordinates, unknown category, `limit` out of range |

## 10. Performance and accessibility

- Catalogue endpoints p95 ≤ 100 ms (cache hit); payloads: regions ≤ 4 kB,
  categories ≤ 6 kB, places ≤ 15 kB (gzip).
- Category chooser is a radio group with names, not only icons; region
  chooser is a labelled listbox; Kannada names carry `lang="kn"`.

## 11. Deployment, rollback and observability

- **Seed** (FR-OPS-015): five regions, six categories (`auto`, `hatchback`,
  `sedan`, `suv`, `tempo_traveller`, `bike`), curated places per region.
  Seed values are illustrative and must be reviewed by the owner.
- **Rollback**: catalogue changes are data; revert by editing. Schema rollback
  drops `places`, `vehicle_categories`, `regions` only before dependent data
  exists.
- **Metrics**: catalogue cache hit ratio; fare-estimate requests; places
  searches with zero results (signal for curation).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | **No admin operations for places** — only public `GET /places` exists. Places are seed/migration data at R1 (FR-CAT-009 `partial`). |
| G-2 | `Region` is a centre + radius circle; no polygons. Overlapping coastal towns are resolved by "nearest centre" (BR-01). |
| G-3 | `RegionInput` / `VehicleCategoryInput` are full replacements (`Omit<…, 'id'>`) that include the immutable `slug` / `code`; a `PUT` whose `slug` / `code` differs from the stored one is rejected with `400 validation_failed` (BR-03). The route comments in `routes.ts` do not yet name these two types. |
| G-4 | No per-region pricing; category pricing is platform-wide. |
| A-1 | Estimate formula and factors (BR-05) are defaults pending a routing provider (D-05). |
| A-2 | Changing category bounds clamps published rates in output rather than rejecting the change (AC-11). |
