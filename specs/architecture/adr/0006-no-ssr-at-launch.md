# ADR-0006 — No server-side rendering at launch

*Status: accepted · 2026-11-10 · Source: brief §4 Frontend ("Server-side rendering only where justified by SEO or initial-render requirements")*

## Context

Most of the product sits behind sign-in or depends on the visitor's location
(search, requests, bookings, partner and admin areas) — content that gains
nothing from SSR. Public, indexable content is limited: the landing page,
package pages, the partner landing page and, later, public driver profiles.
SSR would add a Node rendering tier (or edge functions), hydration
constraints on animation code, and a second place where browser-only APIs
must be guarded.

## Decision

Ship a **client-rendered PWA** served as static files from S3 + CloudFront.

- Initial render is protected by budgets (NFR-PERF-003/004), a small shell,
  self-hosted subset fonts and inline critical SVG.
- Public pages carry correct titles, meta descriptions, canonical URLs,
  Open Graph tags and structured data set at run time.
- Code already keeps browser APIs behind platform adapters (ADR-0007), so
  adding prerendering or SSR later does not require a refactor.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Full SSR with hydration | A rendering service to run, scale and secure; little benefit for authenticated and location-dependent views |
| Build-time prerender of static public routes | **The planned next step** once package and landing content stabilises — low cost, no runtime tier. Deferred, not rejected |
| Separate static marketing site | Two codebases and two design-system copies |

## Consequences

- **Good**: simplest hosting and deployment; one runtime (the browser);
  cheapest to operate.
- **Cost**: search engines and link previews depend on JavaScript rendering;
  social previews for deep pages may be generic until prerendering exists.
- **Trigger to revisit**: organic search becomes an acquisition goal for
  package or driver pages, or field LCP on the landing page misses
  NFR-PERF-003 despite budgets.
- **Guard**: no code outside `core/platform` may touch `window`/`document`
  directly (F-17 AC-09), keeping the SSR door open.
