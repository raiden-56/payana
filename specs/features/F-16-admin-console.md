# F-16 — Admin console

| | |
| --- | --- |
| Requirements | FR-ADM-001 … FR-ADM-012 |
| Priority / release | P0 settings, flags, audit, permission-shaped navigation; P1 overview, users, bookings, staff; P2 health view · R1 |
| Contract | `admin.ts` (`AdminOverview`, `AdminUserRow`, `AdminUserQuery`, `SuspendUserRequest`, `AdminBookingRow`, `AdminBookingQuery`, `ResolveDisputeRequest`, `AuditLogEntry`, `AuditLogQuery`, `StaffMember`, `CreateStaffRequest`, `UpdateStaffRequest`, `ADMIN_PASSWORD_MIN_LENGTH`), `config.ts` (`PlatformSettings`, `PlatformSettingsUpdate`, `FeatureFlag`), `identity.ts` (`AdminRole`, `Permission`, `ADMIN_ROLE_PERMISSIONS`); `ApiRoutes.admin.*` |
| API modules | `admin`, `platform` (settings, audit) |
| Web | `features/admin` (lazy-loaded, own layout) |

## 1. Business objective and scope

One secure place where each kind of staff member does their own job and no
more: see the state of the business, manage accounts, watch bookings, change
configuration, and review who did what.

**In scope** — console shell and navigation by permission; overview; users
(list, suspend, reinstate); bookings (list, detail); settings (support
contact, default region, feature flags, booking fee, analytics — the
analytics form is specified in F-14); audit log; staff.
**Specified elsewhere, hosted here** — verification (F-05), regions and
categories (F-03), plans (F-11), packages (F-10), ad campaigns (F-12),
tickets and review moderation (F-09), dispute resolution (F-08).
**Out of scope** — reports, refunds, coupons, notification templates, health
dashboard (P2; see §12).

## 2. User stories and acceptance criteria

- **US-01** As any administrator I see only what my role allows.
- **US-02** As the owner I see today's numbers at a glance.
- **US-03** As support I find a user by phone and suspend an abusive account.
- **US-04** As the owner I flip a feature off without a release.
- **US-05** As the owner I can answer "who changed that, and when?".
- **US-06** As the owner I add a colleague with exactly one role.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F16-01 | each `AdminRole` signed in | the console loads | the navigation contains exactly the areas whose permission is in `ADMIN_ROLE_PERMISSIONS[role]` (matrix in §3.1); typing the URL of a hidden area shows a "Not permitted" page and the underlying API call returns `403 forbidden` |
| AC-F16-02 | a non-admin account, or no session | any `/admin/**` API route | `403 forbidden` / `401 unauthenticated`; the web route redirects to admin sign-in |
| AC-F16-03 | an admin with `overview.read` | `GET /admin/overview` | `200 AdminOverview` with every section populated and `trend` holding 14 consecutive dates (oldest first, IST days); figures equal counts derived from the database at `generatedAt` (cached ≤ 60 s) |
| AC-F16-04 | an admin with `users.read` | `GET /admin/users?q=98450&role=driver&status=active` | `200 Paginated<AdminUserRow>` matching phone/email/name substring and filters; phones are returned in full to this permission; no document or location data is included |
| AC-F16-05 | an admin with `users.suspend` | `POST /admin/users/{id}/suspend { reason }` | `200 AdminUserRow` `status: "suspended"`; all the user's sessions are revoked; a partner is taken offline and unlisted, active quotes closed; the user is notified `account_notice`; audit `user.suspended` with the reason |
| AC-F16-06 | the same admin | suspends an administrator account, or themselves | `403 forbidden` — staff are managed only through `/admin/staff` |
| AC-F16-07 | a suspended user | `POST /admin/users/{id}/reinstate` | `status: "active"`; the user can sign in; partner verification state is as it was (listing returns only if still eligible); audit `user.reinstated` |
| AC-F16-08 | an admin with `settings.manage` | `PUT /admin/settings { features: { packages: false } }` | `200 PlatformSettings` with only that flag changed (partial update merges per top-level key; within `features` per flag); `GET /public/config` reflects it within 60 s; the feature behaves as disabled (F-10 AC-04); audit `settings.updated` with before/after of changed keys |
| AC-F16-09 | the same | `PUT /admin/settings` with an unknown flag, an unknown `defaultRegionSlug`, a malformed support phone, or invalid analytics/booking-fee values | `400 validation_failed` naming the field; nothing is saved |
| AC-F16-10 | an admin with `settings.read` but not `settings.manage` | reads / writes settings | read succeeds; write → `403 forbidden` |
| AC-F16-11 | an admin with `audit.read` | `GET /admin/audit-logs?action=settings.updated&from=…&to=…` | `200 Paginated<AuditLogEntry>` newest first, filtered; entries contain actor, action, target, metadata, IP, request ID; metadata never contains secrets, OTPs, tokens, passwords or full document numbers |
| AC-F16-12 | any administrator, including `super_admin` | attempts to modify or delete an audit entry | no operation exists; the database role cannot `UPDATE`/`DELETE` the table (NFR-SEC-010) |
| AC-F16-13 | each admin mutation route in `ApiRoutes.admin` and every admin-initiated mutation in F-03, F-05, F-08…F-12 | it succeeds | exactly one audit entry is written in the same transaction with the acting admin's ID |
| AC-F16-14 | a `super_admin` | `POST /admin/staff` with email, name, `adminRole`, `temporaryPassword` (≥ `ADMIN_PASSWORD_MIN_LENGTH`) | `201 StaffMember` `mfaEnabled: false`; the new member's first sign-in forces MFA enrolment (F-01 AC-18); a duplicate email → `409 conflict`; audit `staff.created` |
| AC-F16-15 | a `super_admin` | `PATCH /admin/staff/{id}` changing `adminRole` or `status` | applied; the member's sessions are revoked so new permissions take effect at next sign-in; audit `staff.updated` |
| AC-F16-16 | the only active `super_admin` | demotes or suspends themselves | `409 conflict` — at least one active `super_admin` must remain |
| AC-F16-17 | an admin with `bookings.read` | `GET /admin/bookings?status=disputed` then opens one | list of `AdminBookingRow` and the full `Booking`; resolving needs `bookings.resolve` (F-08 AC-17) |
| AC-F16-18 | an admin session idle for 30 min ◊ | the next action | the session has expired (absolute lifetime 12 h, F-01 BR-09); the console returns to sign-in and restores the page after re-authentication |

## 3. Preconditions, postconditions and business rules

### 3.1 Navigation by role

| Area | Permission | super | verification | support | finance | marketing |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| Overview | `overview.read` | ✔ | ✔ | ✔ | ✔ | ✔ |
| Users | `users.read` | ✔ | ✔ | ✔ | — | — |
| — suspend / reinstate | `users.suspend` | ✔ | — | ✔ | — | — |
| Verification queue | `verification.read` | ✔ | ✔ | ✔ (read) | — | — |
| — review / decide | `verification.review` | ✔ | ✔ | — | — | — |
| Listings moderation | `listings.moderate` | ✔ | ✔ | — | — | — |
| Bookings | `bookings.read` | ✔ | — | ✔ | ✔ | — |
| — resolve disputes | `bookings.resolve` | ✔ | — | ✔ | — | — |
| Support tickets | `support.manage` | ✔ | — | ✔ | — | — |
| Review moderation | `reviews.moderate` | ✔ | — | ✔ | — | — |
| Plans | `plans.manage` | ✔ | — | — | ✔ | — |
| Ad campaigns | `ads.manage` | ✔ | — | — | — | ✔ |
| Packages | `packages.manage` | ✔ | — | — | — | ✔ |
| Regions & categories | `catalog.manage` | ✔ | — | — | — | — |
| Settings (read) | `settings.read` | ✔ | — | — | — | ✔ |
| Settings (write), flags | `settings.manage` | ✔ | — | — | — | — |
| Audit log | `audit.read` | ✔ | — | — | — | — |
| Staff | `staff.manage` | ✔ | — | — | — | — |

Derived from `ADMIN_ROLE_PERMISSIONS`; a unit test regenerates this table
from the constant and fails if the spec and the contract diverge.

### 3.2 Rules

| # | Rule |
| --- | --- |
| BR-01 | The console is a separate lazy-loaded area with its own layout; none of its code is in the customer bundle (NFR-PERF-004). |
| BR-02 | The client reads `Me.admin.permissions` to shape navigation; the API re-derives permissions from the role on every request (F-01 BR-11). |
| BR-03 | Settings are stored per key (`analytics`, `features`, `support`, `bookingFee`, `defaultRegionSlug`); `PlatformSettingsUpdate` is a partial update by top-level key; `features` merges per flag and always returns all `FeatureFlag` keys. |
| BR-04 | A settings change invalidates the public-config cache; worst-case propagation is 60 s (NFR-PERF-007). |
| BR-05 | Audit entries: `action` is a dotted verb from a closed catalogue; `metadata` is an allow-listed, non-sensitive object; `actorLabel` is the admin's email or `system`; entries are immutable and retained 2 years. |
| BR-06 | Suspension requires a reason (5–500 chars), revokes sessions and cascades to marketplace presence (AC-05). Suspension of a user with an active booking is allowed; the booking stays for support to handle. |
| BR-07 | Staff accounts: email unique, no phone, password Argon2id, MFA mandatory; role change and suspension revoke sessions; staff are never hard-deleted (audit integrity). |
| BR-08 | There is always ≥ 1 active `super_admin` (AC-16). The first is created by seed from environment-provided credentials and must rotate its password on first use (see F-01 G-1). |
| BR-09 | Overview figures are aggregates only — no personal data — and are safe to cache for 60 s. |
| BR-10 | Admin screens send no analytics (F-14 BR-11) and are excluded from service-worker data caching. |
| BR-11 | Destructive or high-impact actions (suspend, reject, flag off, role change, `requireConsent` off) require an explicit confirm step stating the consequence. |

## 4. Workflows

**Primary** — admin sign-in (F-01) → Overview → area from navigation → table
with filters → row → action → confirmation → toast + audit.

**Flag change** — Settings → Features → toggle → confirm ("This hides
packages for everyone within one minute") → save.

**Investigate** — Audit log → filter by target (e.g. a user ID) → open the
request ID → correlate with application logs.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Permission removed while signed in | Next API call → `403`; client refreshes `Me`, rebuilds navigation, shows "Your access has changed" |
| ALT-2 | Two admins edit settings at once | Last write wins per top-level key; the audit log shows both; the form warns if the loaded version is stale ◊ |
| ALT-3 | Lost second factor | Another `super_admin` suspends and recreates the account (no reset operation — gap) |
| ALT-4 | Overview query slow | Sections load independently; a failed section shows its own retry |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Table skeleton rows; KPI tiles as skeleton blocks; forms disabled until loaded |
| Empty | Each table has a specific empty message ("No users match", "No audit entries in this period") and a *Clear filters* action |
| Error | Inline error with the `traceId` and *Try again*; `403` shows the not-permitted page; validation errors map to fields |
| Retry | Reads retry manually; writes are never auto-retried — after an unknown outcome the client re-reads before re-offering the action |
| Offline | A blocking banner: "The admin console needs a connection"; no cached admin data is shown |

## 6. API and database changes

| Operation | Request → response | Permission |
| --- | --- | --- |
| `GET /admin/overview` | — → `AdminOverview` | `overview.read` |
| `GET /admin/users` | `AdminUserQuery` → `Paginated<AdminUserRow>` | `users.read` |
| `POST /admin/users/{userId}/suspend` | `SuspendUserRequest` → `AdminUserRow` | `users.suspend` |
| `POST /admin/users/{userId}/reinstate` | — → `AdminUserRow` | `users.suspend` |
| `GET /admin/bookings` | `AdminBookingQuery` → `Paginated<AdminBookingRow>` | `bookings.read` |
| `GET /admin/bookings/{bookingId}` | — → `Booking` | `bookings.read` |
| `POST /admin/bookings/{bookingId}/resolve` | `ResolveDisputeRequest` → `Booking` | `bookings.resolve` |
| `GET /admin/settings` | — → `PlatformSettings` | `settings.read` |
| `PUT /admin/settings` | `PlatformSettingsUpdate` → `PlatformSettings` | `settings.manage` |
| `GET /admin/audit-logs` | `AuditLogQuery` → `Paginated<AuditLogEntry>` | `audit.read` |
| `GET` · `POST /admin/staff` | — / `CreateStaffRequest` → `StaffMember[]` / `StaffMember` | `staff.manage` |
| `PATCH /admin/staff/{userId}` | `UpdateStaffRequest` → `StaffMember` | `staff.manage` |

Other admin routes are listed in their feature specs. Tables:
`platform_settings`, `audit_logs` (append-only; indexes on `at`, `action`,
`actor_id`, `(target_type, target_id)`), `users`, `admin_credentials`.

## 7. Authorisation and security

- Every admin controller declares its permission; a start-up check fails if
  any `/admin` route lacks one (NFR-SEC-002).
- Admin sessions: short access tokens, 12 h absolute refresh, MFA at every
  sign-in, `SameSite=Strict` cookie; the console is served with
  `Cache-Control: no-store` for API responses.
- Admin account takeover (T-08): lockout, MFA, audit of failures, alert on
  repeated failures, no password hints, least privilege limits the blast
  radius, staff changes revoke sessions.
- Insider risk (T-09): case views and all mutations are audited; the audit
  log is readable only by `super_admin`.
- Recommended network control (infrastructure): the admin area can be placed
  behind an IP allow-list or VPN at the load balancer without code change.
- User search is rate-limited (60/min per admin ◊) and requires ≥ 3
  characters of `q` when no other filter is given, to deter bulk export.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `AdminUserQuery.q` | 3–60 chars |
| `role` / `status` | `AccountRole` / `UserStatus` |
| `SuspendUserRequest.reason` | 5–500 chars |
| `PlatformSettingsUpdate.features` | keys ∈ `FeatureFlag`, boolean values |
| `support.phone`, `support.whatsapp` | empty or E.164 (`^\+[1-9]\d{7,14}$`) |
| `support.email` | empty or valid address |
| `defaultRegionSlug` | slug of a `live` region |
| `bookingFee` | F-11 §8 |
| `analytics` | F-14 §8 |
| `AuditLogQuery.action` | `^[a-z_]+(\.[a-z_]+)+$`; prefix match allowed with trailing `.` ◊ |
| `from`, `to` | ISO dates; `from ≤ to`; range ≤ 366 days |
| `CreateStaffRequest.email` | valid, unique, ≤ 254 chars |
| `displayName` | 2–60 chars |
| `adminRole` | `AdminRole` |
| `temporaryPassword` | ≥ `ADMIN_PASSWORD_MIN_LENGTH` (12), ≤ 200; not equal to the email; checked against a common-password list ◊ |
| `UpdateStaffRequest.status` | `active` \| `suspended` |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F16-01 | Unit | Navigation model from permissions for all five roles = table in §3.1 |
| UT-F16-02 | Unit | Settings merge semantics (partial update, flags always complete) |
| UT-F16-03 | Unit | Audit metadata sanitiser strips disallowed keys |
| UT-F16-04 | Unit | "Last super admin" guard |
| IT-F16-01 | Integration | Generated permission matrix: every admin route × five roles + customer + driver + anonymous (AC-01, 02) |
| IT-F16-02 | Integration | Overview figures against seeded data; trend length and dates (AC-03) |
| IT-F16-03 | Integration | User search, suspend cascade, reinstate, admin-target guard (AC-04…07) |
| IT-F16-04 | Integration | Settings update, validation, propagation to public config, audit (AC-08…10) |
| IT-F16-05 | Integration | Audit query filters; immutability at the database (AC-11, 12) |
| IT-F16-06 | Integration | Audit coverage: every admin mutation writes one entry (AC-13), driven from route metadata |
| IT-F16-07 | Integration | Staff create / update / session revocation / last-super-admin (AC-14…16) |
| E2E-F16-01 | E2E | `verification_officer` sees only Overview, Users, Verification; direct URL to Settings shows not-permitted |
| E2E-F16-02 | E2E | `super_admin` turns `packages` off; public site hides packages after refresh; audit entry visible |
| E2E-F16-03 | E2E | Support agent suspends a user; that user's open tab is signed out on next request |
| NT-F16-01 | Negative | Malformed queries and bodies on every route |
| NT-F16-02 | Negative | Privilege escalation attempts: admin creating staff without `staff.manage`; staff changing own role |

## 10. Performance and accessibility

- Tables paginate server-side; list endpoints p95 ≤ 400 ms at R1 volumes;
  audit queries use the indexes above and are bounded by date range.
- Desktop-first (≥ 1 024 px) with usable tablet layout; tables become
  stacked cards below 768 px.
- Data tables use proper header cells, sortable headers as buttons with
  `aria-sort`, row actions as named buttons; confirm dialogs follow the
  shared Dialog component; toasts are announced; no information is conveyed
  by colour alone (statuses are text badges).

## 11. Deployment, rollback and observability

- **Seed**: first `super_admin` from `SEED_SUPER_ADMIN_EMAIL` /
  `SEED_SUPER_ADMIN_PASSWORD` (environment, never committed); default
  settings rows.
- **Rollback**: settings and flags are data — revert by saving the previous
  values (visible in the audit log). Code rollback is a redeploy.
- **Metrics**: admin sign-ins and failures; mutations by action; settings
  changes; 403s by route (signal of probing or of a mis-shaped navigation).
- **Alerts**: > 10 admin `403`s in 5 min from one account; any
  `staff.created`/`staff.updated` (notification to the owner).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | No `GET /admin/users/{id}` detail operation; the list row is all there is. |
| G-2 | No operations for reports, refunds, reconciliation, coupons, notification templates or delivery status (FR-SUB-011…013, FR-NTF-005, FR-BKG-014). |
| G-3 | No admin health view operation (FR-ADM-011); `/health/*` are public probes. |
| G-4 | No staff password reset / change, and no MFA reset operation (see F-01 G-1). |
| G-5 | No admin operations for places (F-03 G-1), featured placements, invoices or subscriptions. |
| G-6 | `AuditLogQuery` cannot filter by request ID or IP. |
| A-1 | Idle timeout, search guards and rate limits are defaults. |
| A-2 | Partial-update semantics of `PlatformSettingsUpdate` (BR-03) are this spec's reading of `Partial<PlatformSettings>`. |
