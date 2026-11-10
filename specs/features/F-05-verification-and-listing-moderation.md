# F-05 — Verification and listing moderation

| | |
| --- | --- |
| Requirements | FR-VER-001 … FR-VER-009 |
| Priority / release | P0 queue, case, document review, decision, gating; P1 expiry, re-verification, listing moderation · R1 |
| Contract | `admin.ts` (`VerificationQueueItem`, `VerificationQueueQuery`, `VerificationCase`, `AdminDocument`, `ReviewDocumentRequest`, `DecideVerificationRequest`, `ModerateListingRequest`), `marketplace.ts`; `ApiRoutes.admin.{verifications, verification, decideVerification, reviewDocument, moderateListing}` |
| API modules | `marketplace` (rules), `admin` (presentation) |
| Web | `features/admin` |

## 1. Business objective and scope

"Verified" is the product's main trust signal. This feature is the human
process that makes it true, and the rules that keep unverified or lapsed
supply out of the marketplace.

**In scope** — queue; case view; per-document review; case decision;
expiry tracking; re-verification triggers; vehicle listing moderation; the
gate that search, requests and quotes rely on.
**Out of scope** — partner-side submission (F-04); background checks (D-14);
automated document OCR/validation (later).

## 2. User stories and acceptance criteria

- **US-01** As a verification officer I work a queue of submitted partners.
- **US-02** As an officer I see each document next to its number and expiry
  and approve or reject it with a reason the partner will understand.
- **US-03** As an officer I approve, send back or reject the partner.
- **US-04** As support I take a problematic listing down.
- **US-05** As a customer, "Verified" always means current, checked documents.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F05-01 | partners in several statuses and regions | an admin with `verification.read` calls `GET /admin/verifications?status=pending&regionSlug=gokarna` | `200 Paginated<VerificationQueueItem>` with only matching cases, oldest `submittedAt` first, each with `documentsPending` and `vehicles` counts |
| AC-F05-02 | a pending case | `GET /admin/verifications/{driverProfileId}` | `200 VerificationCase` with `profile`, `phone`, `vehicles`, `documents` (full `documentNumber`, `fileUrl`, `contentType`) and `history`; each `fileUrl` stops working within 5 minutes; audit `verification.case_viewed` |
| AC-F05-03 | a pending document | admin with `verification.review` posts `{ decision: "approve" }` to `/admin/documents/{id}/review` | `200 AdminDocument` `status: "approved"`, `reviewedAt`, `reviewedBy`; partner notified `document_reviewed`; audit `document.approved` |
| AC-F05-04 | a pending document | `{ decision: "reject" }` without `rejectionReason` | `400 validation_failed`; with a `DocumentRejectionReason` → `status: "rejected"`; the partner sees the reason and note; audit `document.rejected` |
| AC-F05-05 | a document already `approved` or `rejected` | review again | allowed (a mistake can be corrected); the previous decision stays in `history` |
| AC-F05-06 | a document whose `expiresOn` is in the past | approve | `409 document_expired` |
| AC-F05-07 | a case where a person document or a required vehicle document is not `approved` | `{ decision: "approve" }` to `/admin/verifications/{id}/decision` | `409 conflict` listing the blocking documents |
| AC-F05-08 | a case with all applicable documents approved | approve | `200 VerificationCase`; profile `verificationStatus: "approved"`; each vehicle whose required documents are approved becomes `approved` and `listingStatus: "published"`; profile `listingStatus: "published"`; partner notified `verification_decided`; audit `verification.approved` |
| AC-F05-09 | any case | `request_changes`, `reject`, `suspend` or `reinstate` without `note` | `400 validation_failed`; with a note the status becomes `changes_requested` / `rejected` / `suspended` / (previous approved state); on `reject` and `suspend` the partner is taken `offline`, unlisted, and active quotes are closed |
| AC-F05-10 | an approved, available driver | their insurance `expiresOn` passes and the `document-expiry` job runs | document `expired`; vehicle `listingStatus: "unlisted"`; driver `offline` if that was the active vehicle; the driver no longer appears in `GET /drivers`; notification sent; reminders were sent 30, 7 and 1 days ◊ before |
| AC-F05-11 | an approved vehicle | the owner changes its `registrationNumber` or `categoryCode`, or submits a replacement for an approved document | the vehicle (or document) returns to `pending`, the vehicle is unlisted, and the case reappears in the queue |
| AC-F05-12 | an admin with `listings.moderate` | `POST /admin/vehicles/{id}/listing { listingStatus: "suspended", reason }` | `200 Vehicle` `listingStatus: "suspended"`; it leaves search immediately; a driver active on it goes `offline`; `suspended` without `reason` → `400`; audit `listing.suspended` |
| AC-F05-13 | a `suspended` vehicle | its owner edits it or resubmits documents | it stays `suspended`; only an admin can publish it again |
| AC-F05-14 | a `support_agent` (has `verification.read`, not `verification.review`) | calls a review or decision route | `403 forbidden`; a `finance_manager` calling the queue → `403 forbidden` |
| AC-F05-15 | a partner not `approved`, or with no published operable vehicle | they appear in search / receive requests / try to quote | absent from `GET /drivers`; request inbox returns `403 driver_not_verified`; quote returns `403 driver_not_verified` |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | Status machine for `VerificationStatus`: `incomplete` → `pending` (submit) → `approved` \| `changes_requested` \| `rejected`; `changes_requested` → `pending` (resubmission); `approved` → `suspended` (decision) → `approved` (`reinstate`); `approved` → `pending` (re-verification trigger); `rejected` is terminal except by a new decision from an admin. |
| BR-02 | A case can be approved only when: identity approved; driving licence approved unless `partnerType = fleet_owner`; and — unless `hired_driver` — at least one owned vehicle with every `REQUIRED_VEHICLE_DOCUMENT_TYPES` approved and unexpired. A `hired_driver` additionally needs ≥ 1 `active` authorisation to be *listed*, but may be approved without one. |
| BR-03 | Approval of the case approves and publishes only the vehicles that individually qualify; others stay `pending`. |
| BR-04 | `DocumentRejectionReason` is mandatory on rejection; `note` is shown to the partner verbatim, so it must not contain internal remarks. |
| BR-05 | The gate (FR-VER-009): *listed* = profile `approved` + profile `listingStatus: "published"` + operating an operable vehicle (F-04 BR-03/BR-04). Search, request fan-out and quoting all call this one policy. |
| BR-06 | Expiry: a daily job marks documents `expired` on the day after `expiresOn`; reminder notifications at 30, 7 and 1 days ◊ (`AdminOverview.documents.expiringIn30Days` counts the first band). |
| BR-07 | `ListingStatus.Suspended` can only be set and lifted by an admin; `published` ↔ `unlisted` also follows verification automatically. |
| BR-08 | Officers must not review their own partner account (same phone/email as the admin is impossible by construction — admin accounts have no phone — so no extra rule is needed). |
| BR-09 | Every view of a case and every decision is audited with the admin ID; the file link itself is not audited per fetch. |
| BR-10 | Signed document URLs are generated per case view, valid ≤ 5 minutes, and are not cacheable. |

## 4. Workflows

**Primary** — Queue (default filter `pending`) → open case → for each
document: open file in a viewer pane, compare with number and expiry,
approve/reject → when all are decided: approve the case, or request changes
with a summary note → next case.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Two officers open the same case | Both may view; the second decision on the same document succeeds as a correction (AC-05) and both are in history; the queue shows "being viewed by" only as a P2 nicety |
| ALT-2 | File link expired while reading | *Reload document* re-fetches the case |
| ALT-3 | Suspected forgery | Reject with `suspected_forgery`, then decide `suspend`; open a ticket of category `abuse_report` (F-09) |
| ALT-4 | Partner resubmits during review | The case refreshes with the new document `pending`; previous one shows as superseded in history |
| ALT-5 | Reinstatement | `reinstate` returns a suspended partner to `approved` only if BR-02 still holds; otherwise to `pending` |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Table skeleton; case view loads profile first, documents next; file viewer shows a placeholder until the image/PDF loads |
| Empty | "No partners waiting for review" with the count of other statuses as links |
| Error | Queue error with *Try again*; a failed decision keeps the form and shows the server message; `409` shows the blocking documents |
| Retry | Decisions are not auto-retried (they are deliberate); after a network error the client re-reads the case before offering the action again |
| Offline | The admin console requires a connection; an offline banner replaces actions |

## 6. API and database changes

| Operation | Request → response | Permission |
| --- | --- | --- |
| `GET /admin/verifications` | `VerificationQueueQuery` → `Paginated<VerificationQueueItem>` | `verification.read` |
| `GET /admin/verifications/{driverProfileId}` | — → `VerificationCase` | `verification.read` |
| `POST /admin/verifications/{driverProfileId}/decision` | `DecideVerificationRequest` → `VerificationCase` | `verification.review` |
| `POST /admin/documents/{documentId}/review` | `ReviewDocumentRequest` → `AdminDocument` | `verification.review` |
| `POST /admin/vehicles/{vehicleId}/listing` | `ModerateListingRequest` → `Vehicle` | `listings.moderate` |

Tables touched: `driver_profiles`, `vehicles`, `driver_documents`,
`audit_logs`, `outbox_events`. `VerificationCase.history` is read from
`audit_logs` filtered by target. Job: `document-expiry`.

## 7. Authorisation and security

- Permissions as in the table; all five routes are admin-only and audited.
- Full document numbers and files are visible **only** here. The response is
  `Cache-Control: no-store`. File URLs are single-object, short-lived, signed.
- The admin web client does not persist case data or file URLs.
- Threats: insider misuse of documents (T-09: least privilege + audit of case
  views), forged documents (T-02), approval by mistake (correction path,
  history), bulk scraping of cases (admin rate limit 60 case views / 10 min ◊).

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `VerificationQueueQuery.status` | `VerificationStatus`; default `pending` |
| `regionSlug` | existing slug |
| `page` / `pageSize` | ≥ 1 / 1–`MAX_PAGE_SIZE` |
| `ReviewDocumentRequest.decision` | `approve` \| `reject` |
| `rejectionReason` | `DocumentRejectionReason`; required iff rejecting; forbidden when approving |
| `note` | ≤ 500 chars; required when `rejectionReason = "other"` |
| `DecideVerificationRequest.decision` | one of the five literals |
| `note` | 5–500 chars; required unless `approve` |
| `ModerateListingRequest.listingStatus` | `ListingStatus` |
| `reason` | 5–500 chars; required for `suspended` and `unlisted` |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F05-01 | Unit | Verification state machine: every allowed and forbidden transition |
| UT-F05-02 | Unit | Approvability policy per `PartnerType` (BR-02) |
| UT-F05-03 | Unit | "Listed" gate (BR-05) truth table |
| UT-F05-04 | Unit | Expiry classification around midnight IST |
| IT-F05-01 | Integration | Queue filters, ordering, pagination (AC-01) |
| IT-F05-02 | Integration | Case view, signed URL expiry, audit (AC-02) |
| IT-F05-03 | Integration | Document approve / reject / correct / expired (AC-03…06) |
| IT-F05-04 | Integration | Case decisions and side effects on listing, availability, quotes (AC-07…09) |
| IT-F05-05 | Integration | Expiry job with time travel; reminders (AC-10) |
| IT-F05-06 | Integration | Re-verification triggers (AC-11) |
| IT-F05-07 | Integration | Listing moderation (AC-12, 13) |
| E2E-F05-01 | E2E | Officer approves a seeded pending partner; the partner then appears in public search |
| E2E-F05-02 | E2E | Officer rejects a document; partner sees the reason and resubmits |
| NT-F05-01 | Negative | Permission matrix for all five routes × all five admin roles + non-admins (AC-14) |
| NT-F05-02 | Negative | Unknown IDs → `404`; malformed bodies → `400` |
| NT-F05-03 | Negative | Unverified partner blocked from search, inbox, quote (AC-15) |

## 10. Performance and accessibility

- Queue p95 ≤ 300 ms at 5 000 partners (index on `(verification_status,
  submitted_at)`); case view ≤ 400 ms excluding file download.
- Document viewer supports zoom and rotate by keyboard; decisions are buttons
  with explicit names ("Approve insurance", "Reject insurance"); rejection
  reason is a labelled select; destructive decisions require a confirm dialog
  that returns focus to the triggering control.
- Desktop-first layout (two panes ≥ 1 024 px) that collapses to stacked panes
  on tablets; usable, not optimised, at 320 px.

## 11. Deployment, rollback and observability

- **Feature flag**: none — verification is always on.
- **Rollback**: decisions are data; a wrong decision is corrected by another
  decision. No schema of its own beyond F-04.
- **Metrics**: queue size by status; age of oldest pending case; time from
  submission to decision (p50/p90); approval / rejection rates by reason;
  documents expiring in 30 days.
- **Alerts**: oldest pending case > 48 h ◊ (business alert to the owner, not
  on-call).
- **Audit**: `verification.case_viewed`, `document.approved|rejected`,
  `verification.approved|changes_requested|rejected|suspended|reinstated`,
  `listing.published|unlisted|suspended`.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | No operation to assign a case to an officer or lock it while under review. |
| G-2 | `VerificationCase.history` has free-text `action` strings; this spec maps them to audit actions. |
| G-3 | "Listing removal" (§5.C-4) has no delete operation; `suspended` is the strongest state. Removal of data follows account erasure (F-02). |
| G-4 | Listing moderation is per vehicle; there is no operation to moderate a profile's `listingStatus` directly — it follows the verification decision. |
| A-1 | "Verified" covers documents only (D-14). The UI wording is "Documents verified". |
| A-2 | Reminder schedule 30/7/1 days and the 48 h queue alert are defaults. |
