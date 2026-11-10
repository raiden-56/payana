# F-13 — Design system and motion

| | |
| --- | --- |
| Requirements | FR-UX-001 … FR-UX-012; NFR-A11Y-001 … 006; NFR-PERF-003 … 005 |
| Priority / release | P0 (FR-UX-011, 012 P1) · R1 |
| Source | Owner direction of 2026-11-10; constitution §4; brief §4 Frontend |
| Web | `apps/web/src/styles` (tokens, base), `apps/web/src/app/ui` (components, illustrations, motion directives), `features/home`, `features/legal` |
| ADRs | 0008 custom design system · 0005 signals · 0006 no SSR |

## 1. Business objective and scope

The owner asked for good layouts, good colours — **explicitly not the purple
and blue of generic AI-generated sites** — animation including scroll
animation, vector graphics and responsive design. A marketplace that asks
strangers to trust each other must also look like it belongs to its place and
was made with care.

**In scope** — design tokens (colour, type, space, radius, elevation, motion);
the component set; layout grid and breakpoints; original vector illustration
and icons; scroll reveal and scroll-linked animation; route transitions;
micro-interactions; reduced-motion behaviour; the standard loading / empty /
error / offline presentations; the landing page composition; draft legal
pages.
**Out of scope** — dark theme (tokens are structured for it; not shipped at
R1); brand naming; photography; native-platform theming.

## 2. User stories and acceptance criteria

- **US-01** As the owner I see no purple, violet, indigo or blue anywhere.
- **US-02** As a visitor on a small phone everything fits and is thumb-reachable.
- **US-03** As a visitor the page comes alive as I scroll, without getting in
  my way.
- **US-04** As a person sensitive to motion, nothing moves that I did not ask for.
- **US-05** As an engineer I build a new screen from existing parts.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F13-01 | the production build | every colour value in the compiled CSS and in every inline SVG is parsed | no colour with HSL saturation ≥ 10 % has a hue in the open range 165°–330° (cyan, blue, indigo, violet, purple, magenta). The check is automated and fails the build |
| AC-F13-02 | the token file | component and feature styles are scanned | no raw colour literal (hex, `rgb()`, `hsl()`, named colour) appears outside the token definitions and illustration sources; components use semantic tokens only |
| AC-F13-03 | the token pairs listed in §3.2 | contrast is computed | every text pair is ≥ 4.5:1 (≥ 3:1 for large text), every UI/graphic pair ≥ 3:1; the test enumerates the pairs |
| AC-F13-04 | any screen | viewport widths 320, 360, 414, 768, 1024, 1280 and 1440 px | no horizontal scroll, no clipped or overlapping content, no text below 14 px, touch targets ≥ 44 × 44 px on widths < 1024 px |
| AC-F13-05 | the landing page | it is scrolled on a device without reduced-motion | sections enter with a reveal (opacity + ≤ 24 px translate, ≤ 600 ms, staggered ≤ 80 ms) exactly once each; content is present in the DOM and readable before, during and after the animation |
| AC-F13-06 | the landing hero and the "how it works" route | the page scrolls | at least two scroll-linked effects run (hero scene parallax between layers; route path drawn in step with scroll); they animate only `transform`, `opacity` or SVG stroke properties |
| AC-F13-07 | `prefers-reduced-motion: reduce` | any page is used | no parallax, no scroll-linked movement, no looping animation, no reveal translate; route changes are instant or a ≤ 150 ms cross-fade; all content is visible without scrolling into view first |
| AC-F13-08 | JavaScript animation hooks unavailable (observer unsupported, or script failure) | the page loads | all content is visible (reveal is progressive enhancement: the hidden state is applied only after the script has marked the document as animation-capable) |
| AC-F13-09 | a route navigation between two primary views | it completes | a view transition (cross-fade / shared element where defined) of ≤ 300 ms runs where the browser supports it; focus moves to the new view's main heading; scroll position resets (or restores on back) |
| AC-F13-10 | buttons, chips, cards, toggles, inputs | hovered, focused, pressed, loading, disabled | each state is visually distinct; focus is a ≥ 2 px ring with ≥ 3:1 contrast against adjacent colours; press feedback ≤ 120 ms; loading buttons keep their width |
| AC-F13-11 | each `VehicleIcon` and each `PackageArtwork` value | the UI needs artwork | an original inline SVG exists for all six of each; unknown keys fall back to a neutral default without an error |
| AC-F13-12 | every illustration and icon | inspected | it is inline SVG or an SVG sprite (no raster hero art, no icon font, no third-party illustration pack); decorative graphics are `aria-hidden`; meaningful ones have a text alternative; colours come from tokens via `currentColor` or CSS variables |
| AC-F13-13 | a networked screen | it is loading, has no data, fails, or the device is offline | it uses the shared Skeleton, EmptyState, ErrorState (with retry) and OfflineBanner components — no bespoke spinner-only states |
| AC-F13-14 | the landing page | rendered at 360 px and 1280 px | it contains, in order: hero with search, vehicle categories, how it works, featured drivers, sightseeing packages, regions (live and coming soon), partner call to action with plans, local ads strip, FAQ, footer — each section with a heading in a correct outline (one `h1`) |
| AC-F13-15 | the reference device (NFR-PERF-003) | the landing page loads and is scrolled | LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms; no long task > 50 ms attributable to scroll effects |
| AC-F13-16 | a form | fields are invalid on submit | each invalid field shows its message below it, linked by `aria-describedby`, with `aria-invalid`; focus moves to the first invalid field; server `ProblemDetails.errors` map to the same presentation |
| AC-F13-17 | 200 % browser zoom and 400 % (320 px equivalent) | any primary flow | content reflows without loss of function or two-dimensional scrolling |
| AC-F13-18 | terms and privacy routes | opened | each shows a prominent "Draft — pending legal review" notice (FR-UX-012) |

## 3. Preconditions, postconditions and business rules

### 3.1 Palette (reference values ◊ — the token file is authoritative)

| Role | Token | Reference | Use |
| --- | --- | --- | --- |
| Laterite (primary) | `--laterite-700` | `#96340F` | Pressed primary, text links on sand |
| | `--laterite-600` | `#B8431C` | Primary buttons, key accents |
| | `--laterite-500` | `#D2542A` | Large graphics only |
| | `--laterite-100` | `#F9E1D6` | Tinted surfaces |
| Marigold (accent) | `--marigold-600` | `#D98E0F` | Hover of accent surfaces |
| | `--marigold-500` | `#F2A922` | Accent buttons, highlights, auto-rickshaw yellow |
| | `--marigold-100` | `#FDEFC9` | Tinted surfaces, "Featured" chip background |
| Palm (secondary) | `--palm-700` | `#1F4D3A` | Secondary buttons, dark sections, "sea" in illustration |
| | `--palm-500` | `#2F7A5A` | Success, "Verified" |
| | `--palm-100` | `#DCEBE1` | Tinted surfaces |
| Sand (surface) | `--sand-50` | `#FDFAF4` | Page background |
| | `--sand-100` | `#F8F1E3` | Cards on tinted sections |
| | `--sand-200` | `#EFE3CC` | Borders, dividers |
| | `--sand-300` | `#E0CFAE` | Disabled fills |
| Ink (text) | `--ink-900` | `#1C1A17` | Body text, headings |
| | `--ink-700` | `#3A352E` | Secondary text |
| | `--ink-500` | `#6B6358` | Muted text (minimum for text on sand) |
| Status | `--danger-600` | `#A32218` | Errors, destructive |
| | `--warning-700` | `#9A6200` | Warning text |

Rules:

- **BR-01** Hues in 165°–330° at saturation ≥ 10 % are forbidden everywhere,
  including gradients, shadows, focus rings, links, charts, illustrations,
  favicons, the PWA theme colour and third-party widgets the product styles.
- **BR-02** There is no "info blue": informational states use ink on a sand
  tint with an icon.
- **BR-03** Sea and sky in illustration are drawn at dusk/dawn — marigold,
  laterite and sand skies; palm-green and ink water — never blue.
- **BR-04** Marigold is never used for text or thin strokes on sand; text on
  marigold is ink.
- **BR-05** Gradients are limited to adjacent warm hues (e.g. marigold →
  laterite) and to illustration; UI surfaces are flat.
- **BR-06** Components consume semantic tokens (`--color-bg`,
  `--color-surface`, `--color-text`, `--color-text-muted`, `--color-primary`,
  `--color-on-primary`, `--color-accent`, `--color-on-accent`,
  `--color-border`, `--color-focus`, `--color-success`, `--color-danger`,
  `--color-warning`) mapped from the palette, so a theme is a remapping.

### 3.2 Contrast pairs that must pass (AC-F13-03)

| Foreground | Background | Minimum | Reference ratio |
| --- | --- | --- | --- |
| `ink-900` | `sand-50` | 4.5 | ≈ 16 |
| `ink-500` | `sand-50` | 4.5 | ≈ 5.6 |
| `laterite-700` (link) | `sand-50` | 4.5 | ≈ 7 |
| white | `laterite-600` | 4.5 | ≈ 5.4 |
| `ink-900` | `marigold-500` | 4.5 | ≈ 8.6 |
| white | `palm-700` | 4.5 | ≈ 9.6 |
| white | `palm-500` | 4.5 | ≈ 5.2 |
| `danger-600` | `sand-50` | 4.5 | ≈ 7 |
| `warning-700` | `sand-50` | 4.5 | ≈ 4.8 |
| focus ring `ink-900` | `sand-50`, `laterite-600`, `marigold-500` | 3 | — |
| `sand-200` border | — | decorative; inputs also carry a ≥ 3:1 `ink-500` border | — |

### 3.3 Typography, space, shape

| Token group | Rule |
| --- | --- |
| Typefaces ◊ | A characterful display face for headings and a highly legible text face for UI/body, both variable, **self-hosted** (no request to a font CDN), subset to Latin at R1 with system fallbacks covering Kannada and Devanagari (NFR-I18N-003). Reference: Bricolage Grotesque + Figtree |
| Scale | Fluid `clamp()` steps: 14, 16 (body), 18, 20, 24, 30, 38, 48, 64 px at desktop; body never below 16 px on mobile; line-height 1.5 body, 1.15 display |
| Space | 4 px base: 4, 8, 12, 16, 24, 32, 48, 64, 96 |
| Radius | 8 (controls), 16 (cards), 24 (sheets), full (pills) |
| Elevation | Two warm, low shadows (ink at ≤ 12 % alpha); no coloured glow |
| Breakpoints | `sm` 480, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1440; content max-width 1200 px with 16 / 24 / 32 px gutters |
| Grid | 4 columns < `md`, 8 at `md`, 12 at `lg`+ |

### 3.4 Motion

| Token | Value ◊ | Use |
| --- | --- | --- |
| `--motion-fast` | 120 ms | Press, toggle |
| `--motion-base` | 200 ms | Hover, small enter/exit |
| `--motion-slow` | 320 ms | Dialogs, sheets, route transition |
| `--motion-scenic` | 600–900 ms | Hero entrance, illustration loops |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Enter |
| `--ease-in-out` | `cubic-bezier(.4,0,.2,1)` | Move |

- **BR-07** Motion must have a job: orient (route transition, sheet),
  confirm (press, success), or delight once (hero, reveals). Nothing loops
  indefinitely except the hero's ambient scene, which pauses off-screen and
  when the tab is hidden.
- **BR-08** Scroll reveal: an attribute directive adds the hidden state only
  when the document is flagged animation-capable; an IntersectionObserver
  (threshold ≈ 0.15) adds the shown state once and unobserves.
- **BR-09** Scroll-linked effects use CSS scroll-driven animations
  (`animation-timeline: view()` / `scroll()`) where supported and fall back
  to a static end state — not to a scroll listener doing layout.
- **BR-10** Only compositor-friendly properties animate (NFR-PERF-005).
- **BR-11** Reduced motion (NFR-A11Y-004) is implemented once, globally, in
  the base styles and honoured by every directive.
- **BR-12** No animation delays the availability of a control: inputs and
  buttons are interactive as soon as they are painted.

### 3.5 Illustration and icon inventory

| Asset | Count | Notes |
| --- | --- | --- |
| Hero coastal scene | 1 | Layered SVG: sky, sun, hills, temple gopuram silhouette, palms, shore, auto-rickshaw travelling a path; layers parallax on scroll |
| Vehicle artwork | 6 | One per `VehicleIcon`: `auto`, `hatchback`, `sedan`, `suv`, `tempo_traveller`, `bike` |
| Package artwork | 6 | One per `PackageArtwork`: `beach`, `temple`, `waterfall`, `fort`, `hills`, `backwater` |
| How-it-works | 3 | Ask · Compare · Ride, linked by a drawn route |
| States | 5 | No results, no bookings, offline, error, not found |
| Radar | 1 | Concentric distance rings + bearing dots (F-06) |
| Icons | ≈ 40 | 24 px grid, 1.75 px stroke, `currentColor`, single sprite |

### 3.6 Components (minimum set)

Button (primary, secondary, accent, ghost, danger; sizes md/lg; loading),
IconButton, Link, TextField, TextArea, Select, DateTimeField, OtpField,
Checkbox, RadioGroup, Switch, Chip (filter/toggle), Badge (Verified,
Featured, plan, status), Card, Avatar, Rating (display and input), Tabs,
Steps (booking status), Dialog, BottomSheet, Toast, Banner (offline, consent,
notice), Skeleton, EmptyState, ErrorState, Pagination, DataTable (admin),
TopBar, BottomNav (mobile), Footer, AdSlot, Radar, LocationPicker.

Each component: standalone, `OnPush`/signal-driven, no feature knowledge,
documented inputs/outputs, keyboard and screen-reader behaviour stated, unit
tests for states.

## 4. Workflows

**Primary (building a screen)** — compose from `ui` components → use layout
utilities and tokens only → add the four network states → add `appReveal`
where a section enters → verify at the seven widths and with reduced motion.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | A new colour is needed | Add a token with a contrast row and pass the hue check; never an inline literal |
| ALT-2 | A new illustration is needed | Draw to the inventory rules; add to the sprite or as an inline component |
| ALT-3 | Browser lacks View Transitions or scroll-driven animations | Static end state; no polyfill shipped |
| ALT-4 | Long Kannada/Hindi strings | Components wrap; buttons grow in height, never truncate primary labels |

## 5. Loading, empty, error, retry and offline states

This feature **defines** the shared presentations other specs reference:

| State | Component | Rules |
| --- | --- | --- |
| Loading | `Skeleton` | Shape matches the content; shimmer is a slow opacity pulse, static under reduced motion; `aria-busy` on the region; shown only after 150 ms to avoid flicker |
| Empty | `EmptyState` | Illustration, one-line title, one-line help, one primary action |
| Error | `ErrorState` | Plain-language message, the `traceId` in small text for support, *Try again* button; never a raw error |
| Retry | part of `ErrorState` / toast action | Disabled while retrying; announces the result |
| Offline | `OfflineBanner` | Persistent, non-modal, top of viewport; text "You're offline"; disappears on reconnect with a brief "Back online" |

## 6. API and database changes

None. Consumes `VehicleIcon` and `PackageArtwork` keys from the contract.

## 7. Authorisation and security

- No inline event handlers; SVG is authored in-repo (no user-supplied SVG is
  ever inlined). User text is rendered through Angular bindings only.
- Fonts and icons are self-hosted so the CSP needs no third-party font or
  image origin, and no visitor IP reaches a font CDN before consent
  (constitution §2.7).
- Animation never obscures security-relevant UI (consent, payment
  confirmation, destructive confirms appear without entrance delay).

## 8. Validation rules

Shared form behaviour (FR-UX-009):

| Aspect | Rule |
| --- | --- |
| Validators | Central library mirroring contract constants: phone (`INDIAN_MOBILE_E164`), OTP length, registration (`INDIAN_VEHICLE_REGISTRATION`), money (rupee input ↔ minor units), date/time windows, lengths |
| When to show | On blur for a touched field and on submit for all; never while typing the first time |
| Messages | Specific and actionable ("Enter a 10-digit mobile number"), from a keyed catalogue (NFR-I18N-001) |
| Server errors | `ProblemDetails.errors[].field` → control; unmatched errors → form-level alert |
| Submission | Button disabled only while submitting; invalid forms stay submittable to reveal errors |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F13-01 | Unit (script) | Palette hue check over compiled CSS and SVG sources (AC-01) |
| UT-F13-02 | Unit (script) | No raw colour literals outside tokens (AC-02) |
| UT-F13-03 | Unit | Contrast of every pair in §3.2 (AC-03) |
| UT-F13-04 | Unit | `appReveal` directive: capable vs. not capable, reduced motion, once-only |
| UT-F13-05 | Unit | Each component's states (default, hover/focus via class, disabled, loading, error) and ARIA attributes |
| UT-F13-06 | Unit | Validators against contract regexes; rupee ↔ minor-unit conversion |
| UT-F13-07 | Unit | Artwork lookup for all `VehicleIcon` / `PackageArtwork` values and fallback (AC-11) |
| E2E-F13-01 | E2E | Seven-viewport sweep of home, explore, request, booking, partner dashboard, admin queue: no horizontal overflow, target sizes (AC-04) |
| E2E-F13-02 | E2E | Reduced-motion emulation: no running animations, content visible (AC-07) |
| E2E-F13-03 | E2E | Scroll the landing page: sections gain the revealed state once; scroll-linked elements change transform (AC-05, 06) |
| E2E-F13-04 | E2E | axe scan of audited routes: zero serious/critical (NFR-A11Y-006) |
| E2E-F13-05 | E2E | Keyboard-only pass through sign-in and request flows; focus visible and ordered (AC-10, 16) |
| E2E-F13-06 | E2E | Lighthouse CI budgets on `/` (AC-15) |
| E2E-F13-07 | E2E | Visual regression snapshots of the component gallery at 360 and 1280 px |
| NT-F13-01 | Negative | JavaScript disabled for animation hooks → content visible (AC-08) |
| NT-F13-02 | Negative | A deliberately injected `#3b82f6` in a fixture stylesheet makes UT-F13-01 fail |
| NT-F13-03 | Negative | 400 % zoom reflow on primary flows (AC-17) |

## 10. Performance and accessibility

- Budgets: NFR-PERF-003, -004, -005. Hero SVG ≤ 30 kB gzip; icon sprite
  ≤ 12 kB gzip; fonts ≤ 120 kB total, `font-display: swap`, preloaded text
  face only.
- Images (driver and vehicle photos) are lazy, sized, and served in modern
  formats; illustrations are SVG.
- Accessibility requirements are those of NFR-A11Y-001…006; this feature
  owns their implementation in shared components: focus management, live
  regions, target sizes, contrast tokens, reduced motion.

## 11. Deployment, rollback and observability

- **Build gates**: palette hue check, literal check, contrast test, bundle
  budgets, axe, Lighthouse CI.
- **Rollback**: styling is shipped with the web bundle; revert the release.
  Token changes are reviewed with before/after snapshots.
- **Observability**: Web Vitals (LCP, INP, CLS) reported through F-14 when
  enabled; a `reduced_motion` boolean dimension on page views (not personal
  data) shows how many visitors use it.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | No dark theme at R1 (tokens are ready for one). |
| G-2 | No photography direction; driver and vehicle photos are user uploads of variable quality — cards must look right with and without a photo. |
| G-3 | Kannada and Devanagari use system fonts at R1; a matched web font is a later decision. |
| A-1 | Hex values, typefaces, durations and the 165°–330° hue window are reference defaults; the token file and the automated checks are authoritative. |
| A-2 | "Good layouts" is interpreted as the landing composition in AC-F13-14 plus consistent grid, spacing and hierarchy across feature screens. |
| A-3 | Palm green sits near hue 155°; the forbidden window starts at 165° to keep greens while excluding teal-to-cyan. |
