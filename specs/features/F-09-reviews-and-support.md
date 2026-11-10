# F-09 — Reviews and support

| | |
| --- | --- |
| Requirements | FR-REV-001 … FR-REV-005, FR-SUP-001 … FR-SUP-007 |
| Priority / release | P1 (investigation tooling in FR-SUP-006 P2) · R1 |
| Contract | `engagement.ts` (`Review`, `SubmitReviewRequest`, `ReplyToReviewRequest`, `ReviewStatus`, `REVIEW_WINDOW_DAYS`, `REVIEW_COMMENT_MAX_LENGTH`, `SupportTicket`, `TicketMessage`, `CreateTicketRequest`, `AddTicketMessageRequest`, `TicketListQuery`, `TicketCategory`, `TicketStatus`, `TicketPriority`); `ApiRoutes.bookings.review`, `ApiRoutes.drivers.reviews`, `ApiRoutes.driver.replyToReview`, `ApiRoutes.support.*`, `ApiRoutes.admin.{tickets, ticket, ticketMessages, moderateReview}` |
| API module | `apps/api/src/modules/engagement` |
| Web | `features/booking` (review), `features/explore` (reviews on profile), `features/account` (help), `features/partner`, `features/admin` |
| Flag | `FeatureFlag.Reviews` |

## 1. Business objective and scope

Reviews give drivers a portable reputation and customers a reason to trust a
stranger. Support gives both sides somewhere to go when a trip goes wrong —
and gives the operator the record it needs to act.

**In scope** — review submission, public listing, driver reply, moderation,
rating aggregates; tickets, messages, admin queue, priorities; issue reports,
refund requests and abuse reports as ticket categories; the dispute trigger.
**Out of scope** — two-way reviews (A-23); live chat; phone support tooling;
refund execution (P2).

## 2. User stories and acceptance criteria

- **US-01** After a trip I rate the driver and say why.
- **US-02** As a driver I answer a review once, publicly.
- **US-03** As a moderator I hide a review that breaks the rules.
- **US-04** As a user I report a problem with a booking and follow the thread.
- **US-05** As a support agent I work tickets by urgency.

### Reviews

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F09-01 | the customer of a booking `completed` ≤ `REVIEW_WINDOW_DAYS` ago, no review yet | `POST /bookings/{id}/review { rating: 5, comment }` | `201 Review` `status: "published"`, `authorName` as first name + initial ("Anita R."); the driver's `rating.average` and `count` update; driver notified `review_received`; the booking's `reviewSubmitted` is true and `review` leaves `allowedActions` |
| AC-F09-02 | the booking is not `completed`, is older than the window, already has a review, or the caller is the driver | submit | `409 review_not_eligible` (driver / non-party: `403` / `404`) |
| AC-F09-03 | `FeatureFlag.Reviews` off | submit | `403 feature_disabled`; `GET /drivers/{id}/reviews` returns an empty page; ratings are hidden in listings |
| AC-F09-04 | `rating` 0 or 6, or a comment longer than `REVIEW_COMMENT_MAX_LENGTH` | submit | `400 validation_failed` |
| AC-F09-05 | published and hidden reviews for a driver | `GET /drivers/{id}/reviews` | `200 Paginated<Review>` with published reviews only, newest first, including `reply` where present |
| AC-F09-06 | the reviewed driver, no reply yet | `POST /driver/reviews/{id}/reply { text }` | `200 Review` with `reply { text, at }`; a second reply → `409 conflict`; another driver → `404` |
| AC-F09-07 | an admin with `reviews.moderate` | `POST /admin/reviews/{id}/moderation { status: "hidden", reason }` | `200 Review` `status: "hidden"`; it leaves public lists; the driver's average and count are recomputed without it; audit `review.hidden`; setting `published` restores both |
| AC-F09-08 | an admin without `reviews.moderate` | moderate | `403 forbidden` |

### Support

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F09-09 | a signed-in user | `POST /support/tickets` with `category`, `subject`, `body` | `201 SupportTicket` with `reference` (`T-` + 6 digits), `status: "open"`, `priority: "normal"`, one message authored `user` |
| AC-F09-10 | `category: "safety"` | create | `priority: "urgent"`; it sorts first in the admin queue |
| AC-F09-11 | a `bookingId` the caller is not a party to | create | `404 not_found`; with their own booking the ticket carries `bookingId` and `bookingCode` |
| AC-F09-12 | a party opens a ticket of category `fare_dispute` or `safety` against a booking that is active, or `completed`/`no_show` ≤ 7 days ago | create | the booking moves to `disputed` (timeline event by that party's role, audit `booking.dispute_opened`); other categories or older bookings do not change the booking (A-17) |
| AC-F09-13 | a user | `GET /support/tickets`, `GET /support/tickets/{id}` | only their own tickets; another user's → `404` |
| AC-F09-14 | the owner of an `open`, `in_progress` or `waiting_on_user` ticket | `POST /support/tickets/{id}/messages` | `200 SupportTicket` with the new message; a ticket in `waiting_on_user` returns to `open`; on a `closed` ticket → `409 conflict` |
| AC-F09-15 | an admin with `support.manage` | `GET /admin/support/tickets?status=open` | all users' tickets, `urgent` first then oldest `updatedAt` |
| AC-F09-16 | the same admin | `POST /admin/support/tickets/{id}/messages` | message authored `support`; status becomes `waiting_on_user` unless changed; user notified `ticket_updated` |
| AC-F09-17 | the same admin | `PATCH /admin/support/tickets/{id} { status, priority }` | `200 SupportTicket`; audit `ticket.updated`; transitions outside §3 BR-10 → `409 conflict` |
| AC-F09-18 | a driver | opens a ticket about their own booking or listing, and replies | identical behaviour to a customer (FR-SUP-007) |
| AC-F09-19 | 6 tickets created by one user within an hour | a 7th is created | `429 rate_limited` |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | Review eligibility (A-23): caller is the booking's customer; booking `completed`; now ≤ `completedAt` + `REVIEW_WINDOW_DAYS` (14); no review exists for the booking. Bookings resolved from `disputed` to `completed` are eligible from the resolution time. |
| BR-02 | Reviews are immutable once submitted; the only later changes are the driver's single reply and moderation. |
| BR-03 | `authorName` = first word of `displayName` + initial of the last word, or "Customer" if no name. Never the phone. |
| BR-04 | Rating aggregate = mean of published reviews rounded to one decimal; `count` = number of published reviews; both stored on the driver profile and recomputed transactionally on submit and on moderation. |
| BR-05 | Reply: one per review, ≤ `REVIEW_COMMENT_MAX_LENGTH`, by the reviewed driver only, not editable. |
| BR-06 | Moderation hides; it never edits text. A hidden review remains visible to admins and counts for nothing publicly. |
| BR-07 | Ticket `reference` is sequential and non-guessable-relevant (authorisation is by owner, not by reference). |
| BR-08 | Priority: `safety` → `urgent`; `fare_dispute`, `refund_request`, `abuse_report` → `high`; everything else `normal` ◊. Admins may change it. |
| BR-09 | A ticket may be tied to at most one booking, which must be the caller's. |
| BR-10 | Ticket status: `open` → `in_progress` → `waiting_on_user` ⇄ `open`; any → `resolved` → `closed`; `resolved` → `open` if the user replies within 7 days ◊; `closed` is terminal. |
| BR-11 | Dispute trigger: AC-F09-12. Resolution is F-08 (`ResolveDisputeRequest`); resolving the booking does not close the ticket automatically. |
| BR-12 | Refunds (`refund_request`) and abuse (`abuse_report`) are worked as tickets; refund execution and fraud tooling are P2. |
| BR-13 | Message bodies are plain text; phone numbers and links are not stripped (support needs them) but are rendered inert/escaped. |

## 4. Workflows

**Review** — Completed booking → *Rate your trip* → stars (required) +
comment (optional) → submit → thank-you state. Driver: notification → profile
reviews → *Reply*.

**Ticket** — Booking → *Report an issue* (category pre-filtered to booking
categories) or Account → Help → *New ticket* → thread view. Admin: queue →
ticket → reply / change status → resolve.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Review window passed | Action absent (`allowedActions`); deep link shows "Reviews close 14 days after the trip" |
| ALT-2 | Abusive review | Driver opens a ticket (`abuse_report`) quoting the review; moderator hides it |
| ALT-3 | Safety report | Urgent ticket; the booking becomes `disputed`; the form shows local emergency numbers (112) and says Payana is not an emergency service |
| ALT-4 | User replies to a resolved ticket | Reopens within 7 days; later, a new ticket is suggested |
| ALT-5 | Ticket about a suspended account | The user cannot sign in; they use the public support contact from `PublicConfig.support` |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Review list skeleton on profiles; thread skeleton for tickets |
| Empty | Profile: "No reviews yet". Help: FAQ + "No tickets — we're here if you need us". Admin queue: "Nothing waiting" |
| Error | Inline error + *Try again*; a failed message send keeps the text in the composer |
| Retry | Message send is guarded against double submit client-side; a retry after an unknown outcome first re-reads the thread |
| Offline | Review and message composers keep the draft locally and disable send; threads already loaded stay readable |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `POST /bookings/{bookingId}/review` | `SubmitReviewRequest` → `Review` | customer of the booking |
| `GET /drivers/{driverId}/reviews` | `PageQuery` → `Paginated<Review>` | public |
| `POST /driver/reviews/{reviewId}/reply` | `ReplyToReviewRequest` → `Review` | reviewed driver |
| `POST /admin/reviews/{reviewId}/moderation` | `{ status: ReviewStatus, reason? }` → `Review` | `reviews.moderate` |
| `GET` · `POST /support/tickets` | `TicketListQuery` / `CreateTicketRequest` → `Paginated<SupportTicket>` / `SupportTicket` | user |
| `GET /support/tickets/{ticketId}` | — → `SupportTicket` | owner |
| `POST /support/tickets/{ticketId}/messages` | `AddTicketMessageRequest` → `SupportTicket` | owner |
| `GET /admin/support/tickets` | `TicketListQuery` → `Paginated<SupportTicket>` | `support.manage` |
| `GET` · `PATCH /admin/support/tickets/{ticketId}` | — / `{ status?, priority? }` → `SupportTicket` | `support.manage` |
| `POST /admin/support/tickets/{ticketId}/messages` | `AddTicketMessageRequest` → `SupportTicket` | `support.manage` |

Tables: `reviews` (unique `booking_id`; index `(driver_profile_id, status,
created_at desc)`), `support_tickets` (unique `reference`; index
`(status, priority, updated_at)`), `ticket_messages`. Aggregates on
`driver_profiles.rating_average`, `rating_count`.

## 7. Authorisation and security

- Review: customer-of-booking only; reply: reviewed driver only; moderation:
  `reviews.moderate`.
- Tickets: owner-only for users; `support.manage` for the admin routes; a
  ticket never exposes the other party's contact details to the reporter.
- Review fraud (T-06): a review requires a completed booking between two
  distinct accounts; self-dealing signals (same device/session family as the
  driver, repeated bookings between the same pair with instant completion)
  are logged for investigation ◊ (P2 tooling).
- Text is stored raw and rendered escaped; length-limited; rate-limited
  (tickets 6/hour/user ◊, messages 30/hour/user ◊).
- Support agents see user phone numbers in the ticket context only through
  the admin user view (`users.read`).

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `SubmitReviewRequest.rating` | integer 1–5 |
| `comment` | ≤ `REVIEW_COMMENT_MAX_LENGTH` (1 000) chars |
| `ReplyToReviewRequest.text` | 1–1 000 chars |
| Moderation `status` | `ReviewStatus`; `reason` 5–300 chars, required when hiding |
| `CreateTicketRequest.category` | `TicketCategory` |
| `subject` | 3–120 chars |
| `body` | 10–4 000 chars |
| `bookingId` | UUID of a booking the caller is party to |
| `AddTicketMessageRequest.body` | 1–4 000 chars |
| `TicketListQuery.status` | `TicketStatus` |
| Admin patch | `status` ∈ `TicketStatus`, `priority` ∈ `TicketPriority`; at least one present |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F09-01 | Unit | Review eligibility incl. window boundary and disputed-then-completed |
| UT-F09-02 | Unit | `authorName` derivation (single name, Kannada name, empty) |
| UT-F09-03 | Unit | Rating aggregate maths and rounding |
| UT-F09-04 | Unit | Ticket status machine (BR-10) and priority derivation (BR-08) |
| UT-F09-05 | Unit | Dispute trigger policy (category × booking status × age) |
| IT-F09-01 | Integration | Submit review → aggregates → public list (AC-01, 05) |
| IT-F09-02 | Integration | Ineligible paths and flag off (AC-02, 03) |
| IT-F09-03 | Integration | Reply once (AC-06); moderation hide/restore with recompute (AC-07) |
| IT-F09-04 | Integration | Ticket create, priority, booking link, ownership (AC-09…11, 13) |
| IT-F09-05 | Integration | Dispute trigger changes booking status (AC-12) |
| IT-F09-06 | Integration | Thread: user and support messages, status effects, closed ticket (AC-14…17) |
| E2E-F09-01 | E2E | Customer rates a completed trip; the rating appears on the driver's public profile |
| E2E-F09-02 | E2E | Customer reports an issue; support replies; customer sees the reply |
| NT-F09-01 | Negative | Rating bounds, over-long text, missing fields |
| NT-F09-02 | Negative | Cross-user ticket access; driver reviewing; reply by another driver |
| NT-F09-03 | Negative | Permission matrix for admin review and ticket routes (AC-08) |
| NT-F09-04 | Negative | Rate limits (AC-19) |

## 10. Performance and accessibility

- Reviews page of 20 ≤ 300 ms p95; ticket thread ≤ 300 ms p95 up to 100
  messages (older messages paginated client-side at R1).
- Star rating is a radio group of five labelled options ("4 out of 5"),
  operable by arrow keys; average ratings are text ("4.6 out of 5, 38
  reviews") with decorative stars hidden from assistive tech.
- Thread is an ordered list with author and time per message; new messages
  are announced politely; composer has a visible label and character count.

## 11. Deployment, rollback and observability

- **Flag**: `FeatureFlag.Reviews` hides submission and display together.
- **Rollback**: turn the flag off; data is retained.
- **Metrics**: review rate per completed booking; rating distribution;
  hidden-review count; tickets by category/priority; first-response time;
  time to resolution; reopen rate.
- **Alerts**: an `urgent` ticket without a support message for 30 min ◊
  (pages support lead, business hours policy decided by the owner).
- **Audit**: `review.submitted`, `review.replied`, `review.hidden|published`,
  `ticket.created`, `ticket.updated`, `ticket.message_added` (admin only).

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | No operation for a driver to list reviews awaiting their reply other than the public list. |
| G-2 | No attachment support on tickets (photos of a meter, a receipt). |
| G-3 | No ticket assignment field or operation, although the data model reserves `assigned_to`. |
| G-4 | The admin moderation body is described only in a comment in `routes.ts` (`{ status: ReviewStatus, reason? }`) — no exported type. Same for the admin ticket `PATCH` body. |
| G-5 | No operation for an admin to list reviews (moderation works from a profile or a ticket link). |
| G-6 | "Fraud investigation" (§5.C-11) has no dedicated tooling; tickets + audit log serve at R1. |
| A-1 | Dispute trigger and 7-day window (A-17). |
| A-2 | Priority mapping (BR-08) and rate limits are defaults. |
