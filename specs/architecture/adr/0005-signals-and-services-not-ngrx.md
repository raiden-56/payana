# ADR-0005 — Signals and small stores instead of NgRx

*Status: accepted · 2026-11-10 · Source: brief §4 Frontend ("Do not introduce NgRx or another large state library without a documented reason")*

## Context

The web client's state is mostly **server state** (a request and its quotes,
a booking, a list of drivers) with modest client state (session, consent,
form drafts, filters). Features are lazy-loaded and largely independent.
Angular 22 provides signals, computed values, effects and resource-style
async primitives in the framework.

## Decision

1. **Signals** for local and derived UI state.
2. **One small injectable store per feature** (a plain class exposing
   read-only signals and methods) that owns that feature's server state,
   loading/error flags and polling. Stores are provided at the feature route
   so they are created and destroyed with it.
3. **App-wide state** is limited to three core services: session
   (`core/auth`), public configuration (`core/config`) and consent
   (`core/analytics`).
4. **RxJS** stays at the edges: HTTP, router events, timers, visibility and
   network events — converted to signals at the store boundary.
5. No global store library, no action/reducer/effect ceremony, no
   entity-adapter dependency.

A store follows one shape so screens are predictable:
`state: Signal<{ status: 'idle'|'loading'|'ready'|'error', data, error }>`
plus intent methods; components never call the API client directly.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| NgRx Store + Effects | Indirection and boilerplate sized for large teams and heavy cross-feature client state — neither applies |
| NgRx SignalStore | Lighter, but still a dependency whose benefits (plugins, entity helpers) are not needed yet; can be adopted per feature later without rewrites because stores already expose signals |
| Component-local state only | Duplicates polling and error handling; hard to test |
| A query-cache library | Attractive for server state; revisit if cache invalidation logic starts repeating across stores |

## Consequences

- **Good**: small bundle, little ceremony, framework-native, easy unit tests
  (stores are plain classes).
- **Cost**: no time-travel devtools; conventions must be kept by review and
  a store template.
- **Trigger to revisit**: three or more features needing to share and
  mutate the same client-side entity graph, or repeated hand-rolled cache
  invalidation.
