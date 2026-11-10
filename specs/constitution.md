# Payana — Project Constitution

*Version 1.0 · ratified 2026-11-10 · changes require an ADR and a version bump.*

"Payana" (ಪಯಣ, *journey*) is a **working product name**. It lives in one place
on each side (`apps/web/src/app/core/brand.ts`, `APP_NAME` in the API
environment) so it can be replaced without a refactor.

This document is the highest-ranking artifact in the repository. Where any
spec, plan, ticket or line of code disagrees with it, the constitution wins
until it is formally amended.

## 1. Purpose

Payana is a hyperlocal mobility and travel marketplace. It lets visitors and
residents of coastal Uttara Kannada find a trustworthy local auto, taxi or
tour driver, ask for a price, and book — and it lets those drivers be found,
verified and paid fairly. The launch market is Gokarna. Kumta, Honnavar,
Murudeshwar and Karwar follow by configuration, not by redesign.

Payana is a **marketplace and lead platform**, not a transport operator. Drivers
set their own quotations inside platform rules; the customer chooses.

## 2. Non-negotiable principles

1. **Spec before code.** No feature is implemented until its specification
   exists under `specs/features/` with Given/When/Then acceptance criteria.
   The order is: constitution → product requirements → feature specs →
   architecture → API contracts → data model → implementation plan → code →
   tests → security review → release.
2. **Traceable.** Every requirement has an ID. Every ID appears in
   `specs/traceability-matrix.md` with its implementation, its API operation
   and its automated tests — or an explicit, dated "not yet built" status.
3. **Honest status.** A feature is `built`, `partial`, `stubbed` or `planned`.
   Nothing is described as production-ready that has not passed its acceptance
   tests. Stubs (SMS, payments, push) are labelled as stubs in code, in specs
   and in the UI of non-production builds.
4. **Nothing silently dropped.** A requirement that is deferred stays in the
   specs with its status, the reason and the consequence. It is never deleted
   to make a plan look complete.
5. **The server decides.** Authorisation, validation, pricing rules and state
   transitions are enforced by the API on every request. Client-side guards
   and hidden buttons are a courtesy to the user, never a control.
6. **Least privilege.** Customers, drivers and administrators see and change
   only what their role and their relationship to the resource allow. No
   administrator role is all-powerful by default; the privileged role is
   separate, small and requires MFA.
7. **Privacy by default.** Collect the minimum. A driver's exact position is
   never sent to the public; a customer's phone number is never shown to a
   driver before a booking exists. Analytics and advertising tags do not load
   until the visitor consents. The Digital Personal Data Protection Act, 2023
   (India) is the baseline.
8. **Never claim what we do not know.** A stale driver location is shown as
   stale. A PWA is not described as a native app. An indicative rate is not
   described as a fare.
9. **Money is exact.** Amounts are integers in minor units (paise) with an
   explicit currency. Booking and payment writes are transactional and
   idempotent.
10. **Reversible change.** Schema changes ship as forward migrations with a
    documented rollback. Risky behaviour ships behind a feature flag.
11. **Accessible to everyone.** WCAG 2.2 AA is a release gate: keyboard
    operable, screen-reader labelled, 4.5:1 text contrast, visible focus,
    and motion that yields to `prefers-reduced-motion`.
12. **Built for a patchy 4G signal on a beach road.** Mobile first, small
    bundles, explicit loading / empty / error / retry / offline states on
    every screen that talks to the network.

## 3. Architecture rules

- **Modular monolith.** One deployable API, modules with explicit public
  interfaces. A module never reads another module's tables; it calls that
  module's exported service or reacts to its domain events.
- **Clean Architecture inside each module.** `domain` (entities, rules, ports)
  ← `application` (use cases) ← `infrastructure` (TypeORM, Redis, S3, HTTP).
  Dependencies point inward. Frameworks stay at the edge.
- **Ports for everything external.** SMS, payments, push, object storage, maps
  and analytics sit behind interfaces with a real adapter and a development
  adapter. Swapping a vendor is a new adapter, not a rewrite.
- **Contract first.** `packages/contracts` (TypeScript) and
  `specs/api/openapi.yaml` describe the API. Web, future mobile and API all
  compile against the same types. All routes live under `/api/v1`.
- **Region is data.** No town name, coordinate or price is hard-coded in
  application logic. Regions, vehicle categories, plans and fees are rows that
  an administrator edits.
- **No heavy dependency without an ADR.** In particular: no NgRx-class state
  library, no microservice, no server-side rendering and no UI kit is added
  without a recorded decision in `specs/architecture/adr/`.
- **Shared code stays platform-neutral.** Browser-only and native-only APIs
  (geolocation, storage, camera, push) are reached through adapters so the
  same domain and application code can be packaged with Capacitor later.

## 4. Visual identity rules

Set by the product owner and binding on every screen:

- The palette is drawn from the place: **laterite red, marigold (auto-rickshaw)
  yellow, palm green, warm sand and ink**. Purple, violet, indigo and blue are
  **not used** — not as brand colours, not as gradients, not as link colours,
  not in illustrations.
- Illustration is **vector** (inline SVG), drawn for this product: the coast,
  the temple town, the vehicles. No stock 3D blobs, no gradient-mesh heroes.
- Motion has a job — to orient, to confirm, to delight once — and never blocks
  a task. Scroll-linked reveals and route transitions are standard; all of
  them switch off under `prefers-reduced-motion`.
- Layouts are responsive from 320 px to 1440 px+, designed mobile first.

## 5. Definition of done

A change is done when **all** of the following are true:

1. Its feature spec exists and its acceptance criteria are met.
2. Unit tests cover the rules; integration tests cover the API and database
   behaviour; negative tests cover authorisation and validation failures.
3. Lint, type-check, tests and build pass in CI.
4. Loading, empty, error, retry and offline states are implemented for any
   new screen.
5. Inputs are validated at the API boundary; new endpoints declare their
   required permission.
6. Security-relevant actions write an audit log entry.
7. The traceability matrix and, where behaviour changed, the OpenAPI document
   are updated in the same change.
8. Migrations run forward on an empty database and on the previous release.

## 6. Decisions and assumptions

- Significant technical choices are recorded as ADRs (`NNNN-title.md`) with
  context, decision, alternatives and consequences.
- Where the brief is silent or ambiguous, the team **writes the assumption
  down** with its consequences in `specs/product-requirements.md` and
  proceeds. The team stops to ask only when a decision blocks implementation
  or carries material business, security or regulatory risk.
- Open questions that need the product owner are collected in
  `specs/product-requirements.md` § "Decisions needed from the owner".

## 7. Technology baseline (pinned at initialisation, 2026-11-10)

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS |
| Language | TypeScript 6.0, `strict` everywhere |
| Web | Angular 22 — standalone components, signals, lazy routes, PWA |
| API | NestJS 12, REST under `/api/v1`, OpenAPI |
| Data | PostgreSQL 17 + PostGIS 3.5, TypeORM, SQL migrations |
| Cache / coordination | Redis 7 |
| Files | S3-compatible object storage (local-disk adapter in development) |
| Local infra | Docker Compose |
| Cloud | AWS-compatible, Terraform |
| CI | GitHub Actions |

Exact versions are pinned in each `package.json` and lockfile.
