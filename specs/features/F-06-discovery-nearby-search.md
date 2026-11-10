# F-06 — Discovery: nearby search and driver profiles

| | |
| --- | --- |
| Requirements | FR-DSC-001 … FR-DSC-010 |
| Priority / release | P0 (FR-DSC-007, FR-DSC-010 P1) · R1 |
| Contract | `marketplace.ts` (`DriverSearchQuery`, `DriverListing`, `DriverPublicProfile`, `RelativeLocation`, `LocationFreshness`, `DriverSort`, `DEFAULT_SEARCH_RADIUS_KM`, `MAX_SEARCH_RADIUS_KM`); `ApiRoutes.drivers.*` |
| API module | `apps/api/src/modules/marketplace` |
| Web | `features/explore` (list, radar, profile), entry from `features/home` |
| ADRs | 0002 PostGIS · 0015 map deferred |

## 1. Business objective and scope

Answer "who can take me, from here, in this kind of vehicle?" honestly and
quickly, without ever handing a driver's position to the public.

**In scope** — geospatial search; filters; sorting; pagination; region-wide
browsing; the public driver profile; the distance/bearing presentation;
carrying search context into a request.
**Out of scope** — reviews list content (F-09); featured purchase (F-11); the
request itself (F-07); a map (ADR-0015).

## 2. User stories and acceptance criteria

- **US-01** As a visitor I see drivers near me, nearest first.
- **US-02** As a family I filter for six seats.
- **US-03** As a visitor I browse all listed drivers in a town.
- **US-04** As a driver my exact position is not public.
- **US-05** As a visitor I open a driver's profile before asking them.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F06-01 | listed drivers at known distances from a point | `GET /drivers?lat&lng&radiusKm=5&sort=nearest` | `200 Paginated<DriverListing>` containing exactly the listed drivers with a `live` or `recent` position within 5 km, ascending by distance; `total` matches |
| AC-F06-02 | `radiusKm` omitted | search with a point | `DEFAULT_SEARCH_RADIUS_KM` (10) is applied; `radiusKm=51` → `400 validation_failed` |
| AC-F06-03 | a driver whose last position is older than `LOCATION_RECENT_MAX_AGE_SECONDS`, or who never reported | search with a point (not `availableNow`) | the driver may appear (after drivers with a known distance) with `location.freshness: "stale"` / `"unknown"`, `distanceKm: null`, `bearingDeg: null`; they are never placed in the distance ordering |
| AC-F06-04 | any search result | inspect the payload | there is no latitude/longitude of any driver anywhere in the response; `bearingDeg` is a multiple of 10; `distanceKm` has at most one decimal place |
| AC-F06-05 | drivers of several categories and capacities | `categoryCode=suv&minSeats=6` | only vehicles of category `suv` with `seats ≥ 6` |
| AC-F06-06 | verified and unverified partners | default search | only listed (verified, published) drivers (`verifiedOnly` defaults to true); `verifiedOnly=false` never exposes unpublished or suspended listings |
| AC-F06-07 | available, busy and offline drivers | `availableNow=true` | only `availability: "available"` drivers with `live` or `recent` freshness |
| AC-F06-08 | no `lat`/`lng`, `regionSlug=gokarna` | search | all listed drivers serving Gokarna, every `location.distanceKm` null, ordered by `recommended` |
| AC-F06-09 | `lat` without `lng` (or the reverse); `sort=nearest` without a point | search | `400 validation_failed` |
| AC-F06-10 | a featured driver, a paid-plan driver with `priorityInSearch`, and a free driver, otherwise equal | `sort=recommended` | order is featured, then priority plan, then free; `isFeatured` is true and `planBadge` set where applicable; under `sort=nearest`, `rating` or `price` paid status has **no** effect |
| AC-F06-11 | 45 matching drivers | `page=2&pageSize=20` | items 21–40, `total: 45`; `pageSize=51` → `400` |
| AC-F06-12 | a listed driver | `GET /drivers/{id}` | `200 DriverPublicProfile` with `bio`, `memberSince`, `partnerType`, `vehicles`, `operatingHours`, `cancellationRate` (null under 5 bookings); `registrationMasked` only — never the full plate or the phone |
| AC-F06-13 | an unlisted, suspended, rejected or unknown driver ID | `GET /drivers/{id}` | `404 not_found` |
| AC-F06-14 | a search point outside every `live` region | search | `200` with an empty list (not an error); the client shows the out-of-area state |
| AC-F06-15 | search results on screen | the visitor chooses *Request a ride* or *Request this driver* | the request form opens pre-filled with pickup, category, seats and (if from a profile) `targetDriverId` (FR-DSC-010) |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | A driver is searchable only when *listed* (F-05 BR-05). |
| BR-02 | With a point: candidates are drivers whose stored position is within `radiusKm` (`ST_DWithin` on `geography`) **and** whose service areas include the region of the point; drivers serving the region with stale/unknown position follow, without distance, unless `availableNow` is set. |
| BR-03 | `distanceKm` is geodesic distance rounded to 0.1 km; `bearingDeg` is the initial bearing from the search point to the driver rounded to the nearest 10° (0–350). Both are null unless freshness is `live` or `recent`. |
| BR-04 | Freshness: age ≤ 120 s `live`; ≤ 900 s `recent`; otherwise `stale`; no row `unknown` (`LOCATION_*_MAX_AGE_SECONDS`). |
| BR-05 | `recommended` ordering ◊: (1) active featured placement in the region; (2) plan `priorityInSearch`; (3) availability `available` > `busy` > `offline`; (4) freshness `live` > `recent` > others; (5) distance ascending when known; (6) rating average descending (unrated last); (7) completed trips descending. |
| BR-06 | `nearest`: known distance ascending, then unknown. `rating`: average descending, count descending, unrated last. `price`: `rates.perKm` ascending, vehicles without rates last. |
| BR-07 | One result per operating driver, showing the vehicle they are operating (`activeVehicleId`) or, when offline, their primary published vehicle. `categoryCode`/`minSeats` filter on that vehicle. |
| BR-08 | Paid status is always disclosed: `isFeatured` renders a "Featured" label; `planBadge` renders the badge (NFR-COMP-006). |
| BR-09 | The search point is used for the query and discarded; it is not stored or logged (coordinates are excluded from access logs, NFR-PRIV-005). |
| BR-10 | Indicative `rates` are labelled "indicative — ask for a quote" everywhere. |

## 4. Workflows

**Primary — near me** — home hero or `/explore` → location permission →
search with device point → list + radar → filter chips (category, seats,
available now) → sort → open a profile or start a request.

**Primary — browse** — choose a region → list sorted `recommended` → profile.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Location denied or unavailable | Fall back to region browse with an inline "Turn on location to see who's nearest" |
| ALT-2 | Zero results in radius | Offer *Widen to 25 km* and *Send a request anyway* (scheduled requests reach all drivers in the region) |
| ALT-3 | Only stale drivers | List them with "Location not current"; radar shows none; explain why |
| ALT-4 | Outside all live regions | Out-of-area state with live and coming-soon regions |
| ALT-5 | Profile of a driver who went offline | Profile still opens; *Request this driver* remains available for advance trips |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Card skeletons (6) and an idle radar sweep; filters remain interactive and debounce 300 ms |
| Empty | Illustration + reason-specific text (ALT-2/3/4) + next action |
| Error | Inline error with *Try again*; previous results stay visible, dimmed |
| Retry | Manual; changing a filter retries implicitly |
| Offline | Last result set shown with "Offline — results from HH:mm"; freshness labels are downgraded to "not current"; profile pages already visited are available from cache |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /drivers` | `DriverSearchQuery` → `Paginated<DriverListing>` | public |
| `GET /drivers/{driverId}` | — → `DriverPublicProfile` | public |
| `GET /drivers/{driverId}/reviews` | `PageQuery` → `Paginated<Review>` | public (F-09) |

Reads `driver_profiles`, `vehicles`, `driver_locations` (GiST on `location`),
`featured_placements`, `subscriptions`/`plans`, `regions`. Indexes: GiST
`driver_locations(location)`; GIN `driver_profiles(service_area_slugs)`;
partial B-tree on listed profiles. Profile views increment
`driver_stats_daily` asynchronously.

Reference query shape (illustrative; the repository port is the contract):

```sql
SELECT p.id,
       ST_Distance(l.location, :point)              AS distance_m,
       degrees(ST_Azimuth(:point::geometry, l.location::geometry)) AS bearing,
       l.recorded_at
FROM driver_profiles p
JOIN driver_locations l ON l.driver_profile_id = p.id
WHERE p.listed                                  -- F-05 BR-05, maintained flag
  AND :region_slug = ANY (p.service_area_slugs)
  AND l.recorded_at > now() - interval '900 seconds'
  AND ST_DWithin(l.location, :point, :radius_m)
ORDER BY distance_m
LIMIT :limit OFFSET :offset;
```

## 7. Authorisation and security

- Public and unauthenticated; rate-limited per IP (60 searches / min ◊).
- **Location privacy** is the central control: coordinates never leave the
  API; distance is coarse (0.1 km) and bearing coarse (10°). Trilateration
  resistance: results for the same driver are computed from a position
  snapped to a ~100 m grid before distance/bearing are derived ◊, so repeated
  queries from nearby points do not converge below that resolution (threat
  T-03).
- Phone numbers and full plates are absent from every discovery payload.
- Enumeration: driver IDs are UUIDs; unlisted profiles return `404`.

## 8. Validation rules

| Parameter | Rule |
| --- | --- |
| `lat`, `lng` | both or neither; −90…90, −180…180 |
| `radiusKm` | 1–`MAX_SEARCH_RADIUS_KM`; default `DEFAULT_SEARCH_RADIUS_KM`; ignored without a point |
| `regionSlug` | existing `live` region; required when no point is given |
| `categoryCode` | active category code |
| `minSeats` | integer 1–`MAX_PASSENGERS` |
| `verifiedOnly`, `availableNow` | booleans (`true`/`false`) |
| `sort` | `DriverSort`; default `recommended`; `nearest` requires a point |
| `page`, `pageSize` | ≥ 1; 1–`MAX_PAGE_SIZE`, default `DEFAULT_PAGE_SIZE` |
| `driverId` | UUID |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F06-01 | Unit | Distance rounding, bearing rounding (355° → 0°), grid snapping |
| UT-F06-02 | Unit | `RelativeLocation` mapping for each freshness |
| UT-F06-03 | Unit | `recommended` comparator (BR-05) with table-driven cases |
| UT-F06-04 | Unit (web) | Radar projection: bearing/distance → SVG coordinates; stale drivers omitted |
| IT-F06-01 | Integration | Radius inclusion/exclusion at boundaries with seeded coordinates (AC-01, 02) |
| IT-F06-02 | Integration | Stale / unknown handling and ordering (AC-03, 07) |
| IT-F06-03 | Integration | Payload contains no coordinates — schema assertion over the whole response (AC-04) |
| IT-F06-04 | Integration | Filters, sorts, pagination (AC-05, 06, 10, 11) |
| IT-F06-05 | Integration | Region browse and out-of-area (AC-08, 14) |
| IT-F06-06 | Integration | Profile visibility rules (AC-12, 13) |
| IT-F06-07 | Integration | Query plan uses the GiST index; p95 budget at 5 000 drivers (NFR-PERF-002) |
| E2E-F06-01 | E2E | Mocked geolocation → results → filter → profile → request form pre-filled (AC-15) |
| E2E-F06-02 | E2E | Location denied → region browse |
| NT-F06-01 | Negative | Invalid coordinates, half a point, radius out of range, bad sort |
| NT-F06-02 | Negative | Unlisted / suspended driver profile → `404` |

## 10. Performance and accessibility

- NFR-PERF-002 applies. Response ≤ 25 kB gzip for 20 results; images lazy,
  explicit dimensions (CLS).
- The list is the primary, accessible representation; the radar is
  supplementary (`aria-hidden` graphic with a text summary: "5 drivers within
  3 km, nearest 400 m to the north-east").
- Each card is one link with a descriptive name; labels "Verified",
  "Featured", freshness and availability are text, not colour only.
- Filter chips are toggle buttons with `aria-pressed`; result count changes
  are announced politely.

## 11. Deployment, rollback and observability

- **Config**: default/max radius (from the contract), rate limit, grid size.
- **Rollback**: read-only feature; revert the deployment.
- **Metrics**: searches/min; zero-result rate by region and category; p95 DB
  time; share of results with `live` freshness; profile views; search →
  request conversion (via F-14 events).
- **Alerts**: zero-result rate > 60 % for 30 min in a live region during
  06:00–22:00 IST (supply problem, business alert).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | `DriverSearchQuery` has no destination, date, time or trip-type (§5.A-4); carried client-side into the request (FR-DSC-010). |
| G-2 | No language or AC filter, although listings carry `languages` and `hasAc`. |
| G-3 | Result granularity (per driver vs. per vehicle) is not stated in the contract; BR-07 assumes per operating driver. |
| G-4 | No operation to record a profile view; assumed a side effect of `GET /drivers/{id}`. |
| A-1 | `recommended` weights (BR-05) and grid snapping (§7) are defaults. |
| A-2 | Stale-position drivers are still shown (without distance) in point searches so advance bookings can find them. |
