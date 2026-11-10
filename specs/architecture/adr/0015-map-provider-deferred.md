# ADR-0015 — Map provider deferred; curated places and a distance/bearing radar at launch

*Status: accepted · 2026-11-10 · Source: brief §5.A-3/4 (nearby discovery, search by pickup and destination); owner decision D-05 pending*

## Context

A ride marketplace usually shows a map, searches addresses and computes road
distances. Each of those needs a provider (Google Maps Platform, Mapbox,
MapLibre with OpenStreetMap tiles and a hosted geocoder, Ola Maps, …) with
its own pricing, terms of use, key management, attribution rules and — for
default map styles — a blue-dominated palette that conflicts with the
owner's visual direction (F-13). The choice has recurring cost and legal
terms, so it is the owner's (D-05). The launch market is one small town
where pickups and drops cluster around a few dozen known points.

## Decision

Release 1 ships **without a map, geocoder or routing provider**. Three
substitutes cover the launch need, each behind an interface a provider can
later implement:

1. **Curated places** — `GET /places` (`PlaceSearchQuery` →
   `PlaceSuggestion[]`, `PlaceKind`: `transport`, `beach`, `temple`, `town`,
   `landmark`). Admin-curated reference data per region: bus stands, railway
   stations, beaches, temples, town centres, landmarks. A place's
   `regionSlug` may name a region that is not a live market — for example an
   airport used as an outstation endpoint. The **location picker** (F-07)
   offers: the device's current position, the user's saved places, and
   curated places. Whatever the source, the result is a `Place`
   (`label`, optional `address`, `location`).
   A future geocoder returns the same `Place` shape, so `CreateRideRequest`
   and everything downstream are unaffected.
2. **Straight-line estimates** — `FareEstimate.basis = "straight_line"`:
   geodesic distance × a road factor, presented as a wide range labelled
   "estimate". A routing provider later sets `basis = "route"`.
3. **Distance/bearing radar** — nearby drivers are a list first; a vector
   "radar" plots them by distance ring and compass bearing from the search
   point (the only positional data the API discloses — F-06). It is drawn in
   the product palette and needs no tiles.

Ports reserved for the later provider: `GeocoderPort` (search, reverse),
`RoutingPort` (distance, duration), and a `MapView` component boundary in
the web client.

## Alternatives considered

| Alternative | Why not at launch |
| --- | --- |
| Google Maps Platform | Best local data; per-request pricing, API keys and billing account the owner has not set up; default styling needs custom work to avoid blue |
| MapLibre + OSM tiles + hosted geocoder | No licence fee for the renderer, but tile and geocoding services must still be chosen, paid for or self-hosted; OSM coverage of small lanes and homestays in the region is uneven |
| Self-hosted tiles and Nominatim | Operational burden out of proportion to one town |
| Free-text address with no validation | Produces pickups nobody can find |

## Consequences

- **Good**: no key, no bill, no third-party terms at launch; the picker is
  fast on poor connections and works offline from cache; no customer
  location is sent to a map vendor.
- **Cost**: customers cannot pin an arbitrary homestay or lane — they choose
  the nearest curated point (or use current location) and describe the spot
  in `notes`. Estimates are rough on winding coastal and ghat roads.
- **Operational**: someone must curate places per region; at R1 they are
  **seed data** because the contract has no admin operations for places
  (F-03 G-1) — adding those operations is the first follow-up.
- **Expansion**: opening a region includes loading its places
  (release plan §9).
- **Trigger to decide D-05**: pilot feedback that curated points are too
  coarse; disputes about distance; opening a region too large to curate.
- **When a provider is chosen**: add adapters for the two ports, keep
  curated places as the "popular nearby" shortlist, restyle the map to the
  palette, and extend the privacy notice (a location processor is added).
