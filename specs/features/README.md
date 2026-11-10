# Feature specifications

One file per feature. Numbering is fixed; IDs are never reused.

| ID | Feature | Requirement areas | API module(s) | Web area(s) |
| --- | --- | --- | --- | --- |
| [F-01](F-01-identity-and-access.md) | Identity and access | IAM | `identity` | `core/auth`, `features/auth`, `features/admin` (sign-in) |
| [F-02](F-02-customer-account-and-privacy.md) | Customer account and privacy | ACC | `identity` | `features/account` |
| [F-03](F-03-catalog-regions-and-categories.md) | Catalogue: regions, categories, places, public config | CAT | `catalog`, `platform` | `core/config`, `core/api` |
| [F-04](F-04-partner-onboarding-vehicles-documents.md) | Partner onboarding, vehicles, documents, authorisation | PRT | `marketplace` | `features/partner` |
| [F-05](F-05-verification-and-listing-moderation.md) | Verification and listing moderation | VER | `marketplace`, `admin` | `features/admin` |
| [F-06](F-06-discovery-nearby-search.md) | Discovery: nearby search and profiles | DSC | `marketplace` | `features/explore` |
| [F-07](F-07-ride-requests-and-quotations.md) | Ride requests and quotations | REQ | `bookings` | `features/booking`, `features/partner` |
| [F-08](F-08-bookings-lifecycle.md) | Bookings lifecycle | BKG | `bookings` | `features/booking`, `features/partner` |
| [F-09](F-09-reviews-and-support.md) | Reviews and support | REV, SUP | `engagement` | `features/booking`, `features/account`, `features/admin` |
| [F-10](F-10-sightseeing-packages.md) | Sightseeing packages | PKG | `commerce` | `features/packages` |
| [F-11](F-11-subscriptions-featured-and-fees.md) | Subscriptions, featured listings and fees | SUB | `commerce` | `features/partner`, `features/admin` |
| [F-12](F-12-local-business-ads.md) | Local business advertisements | ADS | `commerce` | `ui`, `features/admin` |
| [F-13](F-13-design-system-and-motion.md) | Design system and motion | UX | — | `ui`, `styles`, `features/home` |
| [F-14](F-14-analytics-and-ads.md) | Analytics and ads settings | ANL | `platform` | `core/analytics`, `core/config`, `features/admin` |
| [F-15](F-15-notifications.md) | Notifications | NTF | `engagement`, `platform` | shell, `core/api` |
| [F-16](F-16-admin-console.md) | Admin console | ADM | `admin`, `platform` | `features/admin` |
| [F-17](F-17-pwa-offline-and-mobile-readiness.md) | PWA, offline and mobile readiness | PWA | — | `core/platform`, service worker |
| [F-18](F-18-platform-operations.md) | Platform operations | OPS | `platform` | — |

## Template

Every spec has the same twelve sections, which together cover each item §2 of
the brief mandates:

1. Business objective and scope
2. User stories and acceptance criteria (Given / When / Then, `AC-Fnn-nn`)
3. Preconditions, postconditions and business rules
4. Workflows — primary and alternative
5. Loading, empty, error, retry and offline states
6. API and database changes
7. Authorisation and security
8. Validation rules
9. Test cases — unit, integration, end-to-end, negative
10. Performance and accessibility
11. Deployment, rollback and observability
12. Gaps and assumptions

## Conventions

- API paths are relative to `API_PREFIX` (`/api/v1`) and are quoted from
  `ApiRoutes` in `packages/contracts/src/routes.ts`. A spec never introduces a
  path that is not there; a missing operation is listed under *Gaps*.
- Identifiers in `code font` are symbols exported by `@payana/contracts`.
- Values marked ◊ are defaults chosen by these specs (not by the owner or the
  contract). They are configuration, and the implementation is authoritative
  once it exists — differences are reconciled into the spec, not ignored.
- In acceptance criteria the **`ErrorCode` is normative**; the HTTP status
  shown beside a business-rule failure (`409`, `422`, `403` …) is the
  recommended mapping. Clients branch on `code` only (F-18 BR-01).
- Web paths such as `/requests/:id` are indicative; the authoritative list is
  `apps/web/src/app/app.routes.ts`.
- Test IDs: `UT` unit, `IT` API integration (real PostgreSQL + Redis), `E2E`
  browser, `NT` negative. Automated-test status is tracked only in
  `specs/traceability-matrix.md`.
