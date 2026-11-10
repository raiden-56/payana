# ADR-0008 — Custom design system, no UI kit

*Status: accepted · 2026-11-10 · Source: owner direction of 2026-11-10; brief §4 Frontend ("a consistent, accessible design system")*

## Context

The owner asked for distinctive layouts and colours and explicitly rejected
the purple/blue look of generated sites; for animation, scroll animation and
vector graphics; and for responsive design. Off-the-shelf kits arrive with
their own visual identity (Material's default palettes are violet/indigo/
blue), their own motion, and a bundle cost. The product has three audiences
but a modest component inventory.

## Decision

Build a **small in-house design system** in `apps/web/src/app/ui` and
`apps/web/src/styles`:

- CSS custom-property **tokens** (palette, semantic colours, type, space,
  radius, elevation, motion) — F-13 §3.
- **Standalone Angular components** (≈ 35) with documented inputs, states,
  keyboard and screen-reader behaviour.
- **Original inline-SVG** illustration and a single icon sprite.
- **Motion** as directives and CSS (scroll reveal, scroll-driven animation,
  view transitions) with one global reduced-motion switch.
- Automated guards: forbidden-hue check, no raw colour literals, contrast
  table test, axe and visual regression.

Low-level accessibility primitives (focus trap, overlay positioning, live
announcer) **may** come from a headless, unstyled library such as Angular
CDK if hand-rolling proves error-prone; that is permitted by this ADR
because it carries no visual identity. Styled kits are not.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Angular Material | Strong accessibility, but a recognisable look, default violet/blue theming to fight, and its own motion language |
| Ionic components | Mobile-first widgets that mimic iOS/Android; wrong for the landing and admin areas; see ADR-0007 |
| Tailwind + a component kit | Utility CSS is fine, but kits bring generic aesthetics; token discipline is easier to enforce with our own variables |
| PrimeNG / other suites | Large, themable but heavy; far more than needed |

## Consequences

- **Good**: the product looks like its place; full control of bundle size
  and motion; palette rules are enforceable by tooling.
- **Cost**: the team owns accessibility of every component — hence the
  explicit a11y acceptance criteria and tests in F-13.
- **Risk**: complex widgets (date/time, combobox) are easy to get wrong —
  native inputs are preferred where they exist, and headless primitives are
  allowed.
- **Maintenance**: a component gallery route (non-production) is the living
  documentation and the visual-regression target.
