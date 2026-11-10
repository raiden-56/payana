# F-02 — Customer account and privacy

| | |
| --- | --- |
| Requirements | FR-ACC-001 … FR-ACC-008 |
| Priority / release | FR-ACC-001 P0; others P1 · R1 |
| Contract | `identity.ts` (`Me`, `UpdateMeRequest`, `EmergencyContact`, `SavedPlace`, `ConsentPreferences`, `DeletionRequestStatus`); `ApiRoutes.me.*` |
| API module | `apps/api/src/modules/identity` |
| Web | `features/account` |

## 1. Business objective and scope

Give every account holder control of the little personal data the platform
holds: who they are, the places they reuse, who to call in an emergency, what
they consent to, and the right to leave.

**In scope** — profile fields; saved places; emergency contact; consent
preferences; deletion request, cancellation and erasure.
**Out of scope** — consent banner for anonymous visitors (F-14); partner
profile (F-04); data export / access request (handled by support at R1,
see §12).

## 2. User stories and acceptance criteria

- **US-01** I can set my name so drivers know who to look for.
- **US-02** I can save my homestay once and reuse it as pickup.
- **US-03** I can record an emergency contact.
- **US-04** I decide whether I am measured or advertised to.
- **US-05** I can delete my account, and change my mind for a while.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F02-01 | a signed-in user | `PATCH /me` with `displayName`, `locale` | `200 Me` reflects the change; `GET /me` returns the same |
| AC-F02-02 | a signed-in user | `PATCH /me` with an `email` already used by another account | `409 conflict`; nothing changes |
| AC-F02-03 | a user with no saved places | `POST /me/saved-places` with a valid `SavedPlaceInput` | `201 SavedPlace` with an `id`; it appears in `GET /me/saved-places` |
| AC-F02-04 | a user with `MAX_SAVED_PLACES` saved places | `POST /me/saved-places` | `409 conflict` with a detail naming the limit |
| AC-F02-05 | user A's saved place | user B calls `PUT` or `DELETE /me/saved-places/{id}` | `404 not_found`; A's place is unchanged |
| AC-F02-06 | no emergency contact | `GET /me/emergency-contact` | `200` with body `null`; after `PUT` it returns the contact; after `DELETE` it returns `null` again |
| AC-F02-07 | a new account | `GET /me/consents` | all three flags `false`, `updatedAt: null` |
| AC-F02-08 | a signed-in user | `PUT /me/consents` | `200 ConsentPreferences` with the new values and `updatedAt`; an audit entry `consent.updated` records the three booleans (no other data); the web client immediately updates Consent Mode (F-14) |
| AC-F02-09 | a user with no active booking and no open dispute | `POST /me/deletion-request` | `200 DeletionRequestStatus` `{ requested: true, scheduledFor = requestedAt + ACCOUNT_DELETION_GRACE_DAYS }`; `Me.status = "deletion_requested"`; the user can still sign in |
| AC-F02-10 | a pending deletion request | `DELETE /me/deletion-request` before `scheduledFor` | `200` `{ requested: false }`; `Me.status = "active"` |
| AC-F02-11 | a user with a booking in `ACTIVE_BOOKING_STATUSES` or `disputed` | `POST /me/deletion-request` | `409 conflict` explaining that the booking must finish first |
| AC-F02-12 | a deletion request whose `scheduledFor` has passed | the erasure job runs | sessions revoked; `users.phone`, `email`, `display_name` nulled; saved places, emergency contact, consents and notifications deleted; partner profile unlisted and its documents queued for deletion; bookings and reviews remain with the party shown as "Deleted user"; `Me.status = "deleted"`; signing in with the same phone creates a **new** account |
| AC-F02-13 | an account in `deletion_requested` | it creates a ride request or a quote | allowed until erasure (assumption A-2) |

## 3. Preconditions, postconditions and business rules

**Preconditions** — authenticated; account not `suspended` or `deleted`.

| # | Rule |
| --- | --- |
| BR-01 | `displayName` is what the other party of a booking sees; if empty, drivers see "Customer". |
| BR-02 | `email` is optional, unique (case-insensitive) and **unverified** at R1; it is never used for sign-in. |
| BR-03 | At most `MAX_SAVED_PLACES` (10) saved places per user. |
| BR-04 | One emergency contact per user. It is stored only; nothing is sent to it at R1 (D-15). |
| BR-05 | Consents default to false. Changing them never blocks or degrades core functions. |
| BR-06 | Consent changes are evidenced in the audit log (who, when, values). |
| BR-07 | Deletion grace is `ACCOUNT_DELETION_GRACE_DAYS` (14). During it the account works normally and shows a banner with the erasure date and a cancel action. |
| BR-08 | Erasure is irreversible. Records retained for legal/financial reasons (bookings, invoices, audit) are kept with personal fields removed (NFR-PRIV-003, -006). |
| BR-09 | A suspended account can still request deletion through support, not through the API (suspended accounts cannot authenticate). |
| BR-10 | An administrator account cannot use the deletion-request operation; staff are removed through F-16. |

## 4. Workflows

**Primary** — Account screen with sections *Profile*, *Saved places*,
*Emergency contact*, *Privacy & consent*, *Sessions* (F-01), *Delete account*.
Each section loads independently and saves independently.

**Saved place** — add from current location, from a curated place
(`GET /places`, F-03) or by adjusting a pin-less coordinate entry; choose a
`kind` (`home`, `stay`, `work`, `other`) and label.

**Deletion** — explain consequences → confirm by typing the phone's last four
digits → request → banner with date and *Cancel deletion*.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Email conflict | Field error; other fields still save |
| ALT-2 | Limit of places reached | Add button disabled with the reason; server enforces the same |
| ALT-3 | Active booking blocks deletion | Message links to the booking |
| ALT-4 | Erasure job fails mid-way | Transactional per user; retried next run; alert after 3 failures |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Section skeletons; forms disabled until data arrives |
| Empty | Saved places: illustration + "Save your stay to book faster" + add action. Emergency contact: explanatory text + add action |
| Error | Section-level error with *Try again*; other sections unaffected. Field errors inline |
| Retry | Idempotent `PUT`s can simply be resubmitted; `POST /me/saved-places` is guarded client-side against double submit |
| Offline | Last loaded values shown read-only with an offline note; save buttons disabled |

## 6. API and database changes

| Operation | Request → response |
| --- | --- |
| `GET /me` · `PATCH /me` | — / `UpdateMeRequest` → `Me` |
| `GET` · `PUT` · `DELETE /me/emergency-contact` | — / `EmergencyContact` → `EmergencyContact \| null` / `204` |
| `GET` · `POST /me/saved-places` | — / `SavedPlaceInput` → `SavedPlace[]` / `SavedPlace` |
| `PUT` · `DELETE /me/saved-places/{placeId}` | `SavedPlaceInput` → `SavedPlace` / `204` |
| `GET` · `PUT /me/consents` | — / `ConsentPreferencesInput` → `ConsentPreferences` |
| `GET` · `POST` · `DELETE /me/deletion-request` | — / `DeletionRequestInput` / — → `DeletionRequestStatus` |

Tables: `users`, `saved_places`, `emergency_contacts`, `consents`,
`deletion_requests`. Scheduled job: `account-erasure` (daily).

## 7. Authorisation and security

- All operations are `[user]`; the user ID comes from the token, never from
  the request. Saved places are addressed by ID but always filtered by owner
  (IDOR → `404`).
- Emergency contact and saved places are personal data (location of a home or
  stay is sensitive); they are never returned to any other party or to
  administrators' list views.
- Deletion requires a fresh session (signed in within the last 15 minutes ◊);
  otherwise the client asks the user to sign in again.
- Erasure writes `account.erased` with the user ID only.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `displayName` | 1–60 chars after trim; letters, marks, spaces, `.`, `'`, `-` (Unicode aware, Kannada and Devanagari allowed) |
| `email` | valid address ≤ 254 chars, or `null` to clear |
| `locale` | one of `Locale` |
| `SavedPlaceInput.label` | 1–40 chars |
| `address` | ≤ 200 chars |
| `location.lat` / `lng` | −90…90 / −180…180, ≤ 6 decimal places kept |
| `kind` | `home` \| `stay` \| `work` \| `other` |
| `EmergencyContact.name` | 1–60 chars |
| `EmergencyContact.phone` | `INDIAN_MOBILE_E164`; must differ from the user's own phone |
| `relationship` | ≤ 30 chars |
| `ConsentPreferencesInput` | three booleans, all required |
| `DeletionRequestInput.reason` | ≤ 500 chars |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F02-01 | Unit | Saved-place limit rule |
| UT-F02-02 | Unit | Deletion eligibility (active booking, dispute) |
| UT-F02-03 | Unit | Erasure policy: which fields are nulled, which rows deleted, which retained |
| IT-F02-01 | Integration | Profile update and email uniqueness (AC-01, 02) |
| IT-F02-02 | Integration | Saved places CRUD, limit, ownership (AC-03…05) |
| IT-F02-03 | Integration | Emergency contact lifecycle (AC-06) |
| IT-F02-04 | Integration | Consents default, update, audit (AC-07, 08) |
| IT-F02-05 | Integration | Deletion request, cancel, block, erasure job with time travel (AC-09…12) |
| E2E-F02-01 | E2E | Edit name, add a saved place, see it offered in the request form |
| E2E-F02-02 | E2E | Turn analytics consent off and observe Consent Mode update (with F-14) |
| NT-F02-01 | Negative | Out-of-range coordinates, over-long strings, unknown properties |
| NT-F02-02 | Negative | Emergency phone equal to own phone |
| NT-F02-03 | Negative | Unauthenticated access to every `/me` route → `401` |

## 10. Performance and accessibility

- Each section's request p95 ≤ 300 ms; the account screen makes no more than
  four requests on entry.
- Toggle controls are real checkboxes/switches with labels and descriptions;
  the destructive deletion flow is reachable and operable by keyboard, with
  the confirm button disabled until the confirmation text matches and the
  reason announced.

## 11. Deployment, rollback and observability

- **Migration** adds the four tables and `users.status` values. **Rollback**:
  drop tables; consent and deletion evidence in `audit_logs` is unaffected.
- **Job** `account-erasure`: daily at 02:30 IST ◊, distributed lock, metric
  `erasure_completed_total`, `erasure_failed_total`.
- **Audit**: `profile.updated`, `consent.updated`, `account.deletion_requested`,
  `account.deletion_cancelled`, `account.erased`.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | No data-access / export operation (DPDP right of access). Served manually via a support ticket (`TicketCategory.Account`) at R1. |
| G-2 | No email verification operation; `email` is informational. |
| G-3 | No per-channel notification preferences beyond `marketingMessages`; `NotificationChannel` exists without a preference type. |
| A-1 | "Preferences" in §5.A-2 is satisfied by `locale` and consents. |
| A-2 | An account awaiting deletion may keep using the product until erasure. |
| A-3 | Re-registration with the same phone after erasure starts a fresh account with no history. |
