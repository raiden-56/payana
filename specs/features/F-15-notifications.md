# F-15 — Notifications

| | |
| --- | --- |
| Requirements | FR-NTF-001 … FR-NTF-007 |
| Priority / release | P1 (SMS / push / email delivery and FR-NTF-005 P2) · R1 |
| Contract | `engagement.ts` (`AppNotification`, `NotificationList`, `NotificationType`, `NotificationChannel`); `ApiRoutes.notifications.*` |
| API modules | `engagement` (notification store, handlers), `platform` (outbox, channel ports) |
| Web | shell (bell + panel), `core/api` |
| ADRs | 0012 polling · 0010 SMS port · 0007 PWA first |

## 1. Business objective and scope

Tell each party what just changed — a quote arrived, a booking moved, a
document was rejected — without coupling the business transaction to message
delivery, and without promising delivery channels a PWA cannot keep.

**In scope** — in-app notifications; the event → notification mapping; the
transactional outbox and handlers; channel ports with development adapters;
polling; the consent rule for promotional messages.
**Out of scope at R1** — real SMS (other than OTP's own port), web push,
native push, email, admin-editable templates and delivery reports (P2).

## 2. User stories and acceptance criteria

- **US-01** As a customer I am told when a quote arrives, even on another page.
- **US-02** As a driver I am told when my quote wins or loses, and when my
  documents are reviewed.
- **US-03** I can see what I missed and clear it.
- **US-04** As the operator, a failed notification never fails a booking.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F15-01 | a signed-in user with read and unread notifications | `GET /notifications` | `200 NotificationList` — newest first, at most 50 ◊, with `unreadCount`; `?unreadOnly=true` returns unread only |
| AC-F15-02 | an unread notification of the caller | `POST /notifications/{id}/read` | `204`; `readAt` set; `unreadCount` decreases; repeating is a no-op `204`; another user's ID → `404` |
| AC-F15-03 | several unread | `POST /notifications/read-all` | `204`; `unreadCount` is 0 |
| AC-F15-04 | each business event in §3.1 | its transaction commits | exactly one in-app notification per recipient is created within 5 s ◊, with the listed `type`, a title, a body and a `link` to the relevant in-app path |
| AC-F15-05 | the business transaction rolls back | — | no outbox row and no notification exist |
| AC-F15-06 | a notification handler throws | the outbox worker runs | the business data is unaffected; the event is retried with back-off up to 10 times, then parked; later events are still processed; a metric and alert fire (NFR-REL-005) |
| AC-F15-07 | the same outbox event delivered twice | handlers run | one notification exists (handlers are idempotent on event ID + recipient) |
| AC-F15-08 | a notification's `link` | the user activates it | the app navigates to that in-app path and marks it read; `link` is always a relative path beginning with `/` — never an external URL |
| AC-F15-09 | any notification payload | inspected | title and body contain no phone number, no full name of the other party beyond first name, no document number |
| AC-F15-10 | a promotional message (any message not caused by the user's own transaction) | a send is attempted to a user with `marketingMessages: false` | it is not sent on any channel; `account_notice` operational messages are exempt |
| AC-F15-11 | a signed-in client with the tab visible | time passes | notifications are polled every 60 s ◊ (requests supported by `ETag`); polling pauses when the tab is hidden or the device is offline and runs once immediately on return |
| AC-F15-12 | the development channel adapters | an event that would send SMS/push/email at a later release occurs | the adapter logs a structured "would send" line without personal data and records nothing else; in production with a development adapter configured for a channel that is switched on, start-up fails |

## 3. Preconditions, postconditions and business rules

### 3.1 Event → notification map

| Domain event (outbox `type`) | Recipient | `NotificationType` | Link |
| --- | --- | --- | --- |
| `ride_request.created` | each notified driver | `new_ride_request` | `/driver/requests/{id}` |
| `quote.submitted` | customer | `quote_received` | `/requests/{id}` |
| `ride_request.expired` | customer | `request_expired` | `/requests/{id}` |
| `quote.accepted` | winning driver | `quote_accepted` | `/driver/bookings/{id}` |
| `quote.accepted` | other quoting drivers | `quote_not_chosen` | — |
| `booking.transitioned` | customer | `booking_status_changed` | `/bookings/{id}` |
| `booking.cancelled` | the other party | `booking_cancelled` | booking path for that role |
| `booking.dispute_resolved` | both parties | `booking_status_changed` | booking path |
| `document.reviewed` | partner | `document_reviewed` | `/driver/onboarding` |
| `document.expiring` / `document.expired` | partner | `document_expiring` | `/driver/onboarding` |
| `verification.decided` | partner | `verification_decided` | `/driver` |
| `authorization.created` | invited driver (when an account exists) | `authorization_invite` | `/driver/vehicles` |
| `subscription.changed` | partner | `subscription_changed` | `/driver/subscription` |
| `review.submitted` | driver | `review_received` | driver's reviews |
| `ticket.message_added` (by support) / `ticket.updated` | ticket owner | `ticket_updated` | `/account/help/{id}` |
| `account.suspended`, `account.deletion_scheduled` | user | `account_notice` | `/account` |

Links are indicative web paths (see features/README conventions).

### 3.2 Rules

| # | Rule |
| --- | --- |
| BR-01 | A use case writes its state change **and** its outbox event in one database transaction. Nothing is sent inside the request. |
| BR-02 | The outbox worker claims events with `FOR UPDATE SKIP LOCKED`, in `occurred_at` order per aggregate, and runs under a distributed lock-free model safe for several API instances. |
| BR-03 | Handlers are idempotent; delivery is at-least-once. |
| BR-04 | In-app is the only channel that must work at R1. `NotificationChannel.Sms`, `Push`, `Email` are ports with development adapters. |
| BR-05 | Channel choice per type (target, R1.1+): time-critical types (`quote_received` for immediate trips, `quote_accepted`, `booking_cancelled`, `booking_status_changed` to `driver_arrived`) also go to push, with SMS as fallback when no push registration exists ◊. |
| BR-06 | Text is generated from keyed templates in code at R1 (English); template editing by administrators is P2 (FR-NTF-005). |
| BR-07 | Notifications are retained 180 days (NFR-PRIV-003) and deleted on account erasure. |
| BR-08 | Content is minimal (AC-09): the detail lives behind the link, which requires authentication. |
| BR-09 | **PWA honesty** (FR-PWA-008): the product does not claim to alert a driver whose browser is closed. The partner dashboard states that new requests are seen while the app is open, until native push exists. |
| BR-10 | Promotional sends require `ConsentPreferences.marketingMessages` (AC-10). |

## 4. Workflows

**Primary** — business transaction commits with an outbox row → worker
picks it up → handler resolves recipients → inserts notifications → client's
next poll shows the unread badge → user opens the panel → activates an item
→ navigates and marks read.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Recipient account erased or suspended | Notification skipped; event marked processed |
| ALT-2 | Burst (30 drivers notified of one request) | One outbox event; the handler fans out in a single batch insert |
| ALT-3 | Worker down | Events accumulate; lag alert at 5 min; on restart they are processed in order |
| ALT-4 | User is already viewing the linked screen | The screen's own polling shows the change; the notification still arrives and is auto-marked read when the screen is in view ◊ |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Bell shows no badge until the first response; panel shows 3 skeleton rows |
| Empty | "You're all caught up" |
| Error | Panel-level "Couldn't load notifications" + *Try again*; the badge keeps its last value |
| Retry | Polling backs off 60 → 120 → 300 s on failure and resets on success |
| Offline | Panel shows the last list with an offline note; mark-read actions are queued in memory and sent on reconnect (the only queued write in the product, because it is idempotent and harmless) |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /notifications` | `?unreadOnly` → `NotificationList` | user |
| `POST /notifications/{notificationId}/read` | — → `204` | user (own) |
| `POST /notifications/read-all` | — → `204` | user |

Tables: `notifications` (index `(user_id, created_at desc)`; partial index
on unread), `outbox_events` (index on unprocessed by `available_at`). Worker:
in-process poller (1 s ◊ interval, batch 50) — replaceable by SQS/SNS when a
module is extracted (ADR-0001).

## 7. Authorisation and security

- Users read and mutate only their own notifications (`404` otherwise).
- `link` values are generated server-side from fixed templates — never from
  user input — and are relative paths (open-redirect and phishing safety).
- Titles and bodies are plain text, escaped on render.
- Outbox payloads carry IDs, not personal data; handlers load what they need.
- Channel adapters receive the minimum (destination, template key,
  variables) and must not log destinations unmasked.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `unreadOnly` | boolean; default false |
| `notificationId` | UUID |
| Generated `title` | ≤ 80 chars |
| Generated `body` | ≤ 240 chars |
| Generated `link` | null or `^/[A-Za-z0-9/_-]*$`, ≤ 200 chars |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F15-01 | Unit | Event → recipients/type mapping for every row of §3.1 |
| UT-F15-02 | Unit | Template rendering: lengths, no PII, link format |
| UT-F15-03 | Unit | Outbox retry schedule and parking after 10 attempts |
| UT-F15-04 | Unit (web) | Polling scheduler: visibility, offline, back-off |
| IT-F15-01 | Integration | Transactional outbox: commit creates, rollback does not (AC-04, 05) |
| IT-F15-02 | Integration | Worker with two instances: each event handled once; handler idempotency (AC-07) |
| IT-F15-03 | Integration | Failing handler does not block later events; parked after retries (AC-06) |
| IT-F15-04 | Integration | List, unread filter, mark read, read all, ownership (AC-01…03) |
| IT-F15-05 | Integration | Marketing consent gate (AC-10) |
| E2E-F15-01 | E2E | Driver quotes → customer's bell shows 1 → opening it navigates to the request and clears the badge |
| NT-F15-01 | Negative | Foreign notification ID → `404`; unauthenticated → `401` |
| NT-F15-02 | Negative | Production start-up with a development adapter on an enabled channel (AC-12) |

## 10. Performance and accessibility

- `GET /notifications` p95 ≤ 150 ms; conditional requests return `304` when
  nothing changed. Outbox lag p95 ≤ 5 s at R1 load.
- The bell is a button with an accessible name including the count ("3
  unread notifications"); the panel is a labelled region listing items as
  links with time; new arrivals are announced once, politely, as a count —
  not item by item.

## 11. Deployment, rollback and observability

- **Config**: worker interval and batch size, retry limits, per-channel
  adapter selection, polling interval hint.
- **Rollback**: the worker can be disabled by configuration; events queue
  and are processed when it is re-enabled. Schema is additive.
- **Metrics**: outbox lag, processed/failed/parked counts, notifications
  created by type, unread backlog per user (p95), polling 304 ratio.
- **Alerts**: outbox lag > 5 min; parked events > 0.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | **No contract types or routes** for push-token registration, channel preferences, templates or delivery status (FR-NTF-004/005, permission `notifications.manage` unused). |
| G-2 | `NotificationList` is not paginated; capped at 50. |
| G-3 | `AppNotification` carries no reference to the entity other than `link`. |
| G-4 | No real-time transport (ADR-0012); worst-case in-app latency is the polling interval. |
| A-1 | Polling intervals, caps and channel mapping are defaults. |
| A-2 | Reminder notifications before a scheduled trip are desirable but have no `NotificationType`; `booking_status_changed` is not used for reminders. Recorded as a contract gap. |
