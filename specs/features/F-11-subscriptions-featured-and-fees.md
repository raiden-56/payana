# F-11 — Subscriptions, featured listings and fees

| | |
| --- | --- |
| Requirements | FR-SUB-001 … FR-SUB-013 |
| Priority / release | P1 (FR-SUB-011, 012, 013 P2) · R1 on the manual payment adapter |
| Contract | `commerce.ts` (`SubscriptionPlan`, `SubscriptionPlanInput`, `PlanEntitlements`, `BillingPeriod`, `DriverSubscription`, `SubscriptionStatus`, `SubscriptionCheckoutRequest`, `CheckoutSession`, `PaymentProvider`, `Invoice`, `InvoiceStatus`, `FeaturedPlacement`, `PurchaseFeaturedPlacementRequest`, `BookingFeeSettings`); `ApiRoutes.plans.root`, `ApiRoutes.driver.{subscription, subscriptionCheckout, subscriptionCancel, invoices, featuredPlacements}`, `ApiRoutes.admin.{plans, plan, settings}` |
| API module | `apps/api/src/modules/commerce` (+ `platform` settings) |
| Web | `features/partner` (plans, subscription, invoices, featured), `features/home` (partner landing), `features/admin` |
| Flags | `FeatureFlag.Subscriptions`, `FeatureFlag.FeaturedListings` |
| ADRs | 0009 payment port · 0017 money |

## 1. Business objective and scope

Earn revenue from supply without taking commission on rides: drivers pay for
reach and tools; the free tier always works.

**In scope** — plans and entitlements; checkout through the payment port;
subscription state and usage; invoices; cancelling auto-renewal; renewal and
lapse; featured placements; admin plan management; booking-fee settings.
**Out of scope at R1** — real money movement, refunds, reconciliation,
coupons, financial reports (P2, §12).

> **R1 honesty note.** `PaymentProvider.Manual` completes every checkout
> immediately and moves no money. Non-production builds label checkout
> "Test mode — no payment taken". Paid plans must not be sold to real drivers
> until a gateway adapter exists (release plan §8).

## 2. User stories and acceptance criteria

- **US-01** As a driver I compare plans and see exactly what each gives me.
- **US-02** I upgrade, see my new limits at once, and get an invoice.
- **US-03** I stop renewal and keep what I paid for until the period ends.
- **US-04** I feature my vehicle for the festival week.
- **US-05** As finance I change prices and entitlements for new purchases.
- **US-06** As the owner I can turn a booking fee on later.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F11-01 | seeded plans `free`, `plus`, `pro` | `GET /plans` | `200 SubscriptionPlan[]` — active plans by `sortOrder`, each with `price`, `billingPeriod`, `entitlements`, `highlights`, `isRecommended` |
| AC-F11-02 | a partner who never purchased | `GET /driver/subscription` | `200 DriverSubscription` on the `free` plan, `status: "active"`, `usage` populated |
| AC-F11-03 | a partner on `free` | `POST /driver/subscription/checkout { planId: plus }` with an `Idempotency-Key`, manual adapter | `200 CheckoutSession { provider: "manual", status: "completed", amount }`; an `Invoice` `paid`; subscription `active` on `plus` with `currentPeriodEnd = start + 1 period`; notification `subscription_changed`; audit `subscription.purchased` |
| AC-F11-04 | the same key and body repeated | checkout | the same `CheckoutSession`; exactly one invoice and one subscription change |
| AC-F11-05 | `FeatureFlag.Subscriptions` off | checkout | `403 feature_disabled`; `GET /plans` still lists plans (read-only) |
| AC-F11-06 | an inactive or unknown `planId`, or the plan already held | checkout | `404 not_found` / `409 conflict` |
| AC-F11-07 | a partner on `pro` (unlimited quotes, 5 vehicles) who then lapses to `free` (1 vehicle) | entitlements are evaluated | extra vehicles become `unlisted` (the partner chooses which one stays listed; default: most recently active); nothing is deleted; quote limit applies from that moment |
| AC-F11-08 | a plan with `monthlyQuoteLimit: 30` and 30 quotes sent this calendar month (IST) | the partner quotes | `403 entitlement_exceeded`; `usage.quotesSent = 30` |
| AC-F11-09 | an active paid subscription | `POST /driver/subscription/cancel` | `200 DriverSubscription` `autoRenew: false`, still `active` until `currentPeriodEnd`; at period end it becomes `expired` and the partner is on `free` |
| AC-F11-10 | an active subscription with `autoRenew: true` reaching `currentPeriodEnd` | the renewal job runs (manual adapter) | a new paid invoice and a new period; with a gateway adapter a failed charge → `past_due` for 7 days ◊ then `expired` |
| AC-F11-11 | a partner | `GET /driver/invoices` | `200 Paginated<Invoice>` — own invoices newest first with `number` (`INV-YYYY-NNNNNN`), `status`, `amount`, `provider` |
| AC-F11-12 | a plan with `featuredDaysIncluded: 7`, 0 used | `POST /driver/featured-placements { vehicleId, regionSlug, startsOn, days: 5 }` with an `Idempotency-Key` | `201 FeaturedPlacement` `fromPlanAllowance: true`; `usage.featuredDaysUsed = 5`; no invoice |
| AC-F11-13 | allowance exhausted | purchase 3 more days | `201` with `fromPlanAllowance: false`; an invoice for 3 × the per-day price ◊ is created and settled by the adapter |
| AC-F11-14 | a vehicle the caller does not own, a non-operable vehicle, a region the partner does not serve, `days` outside 1–30, `startsOn` in the past, or an overlapping placement for the same vehicle and region | purchase | `404` / `409 conflict` / `400 validation_failed` as appropriate |
| AC-F11-15 | a placement whose date range includes today | search under `recommended` in that region | the driver operating that vehicle has `isFeatured: true` and ranks first (F-06 BR-05); outside the range `isFeatured` is false |
| AC-F11-16 | an admin with `plans.manage` | `PUT /admin/plans/{id}` changing price or entitlements | `200 SubscriptionPlan`; new checkouts use the new values; **existing subscriptions keep the entitlements and price they bought until their period ends** (snapshot); audit `plan.updated` |
| AC-F11-17 | an admin | deactivates a plan | it leaves `GET /plans`; current subscribers keep it until period end, then fall to `free`; the `free` plan cannot be deactivated (`409 conflict`) |
| AC-F11-18 | a `super_admin` | `PUT /admin/settings { bookingFee: { enabled: true, flatMinor: 1000, percent: 2, capMinor: 5000 } }` | saved; `PublicConfig.bookingFee` reflects it within 60 s; new bookings compute the fee (F-08 AC-02); existing bookings are unchanged |
| AC-F11-19 | `bookingFee.enabled: true` while the payment provider is `manual` in a production environment | save settings | `409 conflict` explaining that a fee cannot be collected without a gateway (A-08) |
| AC-F11-20 | admins without `plans.manage`; non-`super_admin` writing settings | the admin routes | `403 forbidden` |

## 3. Preconditions, postconditions and business rules

| # | Rule |
| --- | --- |
| BR-01 | Every partner always has exactly one current subscription; absent a purchase it is the `free` plan (no invoice, no end date in effect — `currentPeriodEnd` rolls monthly). |
| BR-02 | A purchase snapshots the plan's `price` and `entitlements` onto the subscription for the period. |
| BR-03 | Upgrade takes effect immediately and starts a new period ◊ (no proration at R1). Downgrade to a cheaper paid plan takes effect at period end ◊. |
| BR-04 | `SubscriptionStatus`: `pending_payment` (gateway only) → `active` → (`past_due` →) `expired`; `cancelled` marks a subscription whose auto-renew was stopped and whose period has ended. |
| BR-05 | Entitlements: `maxVehicles` (F-04 BR-10), `monthlyQuoteLimit` per calendar month IST (F-07 BR-08), `priorityInSearch` and `badge` (F-06 BR-05/BR-08), `featuredDaysIncluded` per billing period, `analytics` (gates `GET /driver/metrics` beyond the basic counters ◊). |
| BR-06 | Over-limit on lapse never deletes data; it unlists. |
| BR-07 | Featured placement: one vehicle, one region, `days` 1–30, contiguous from `startsOn`; status `scheduled` → `active` → `ended` by date; `cancelled` only by an admin. Plan allowance is consumed first; a single purchase is not split between allowance and paid days ◊ — if the allowance does not cover all days the whole purchase is paid. |
| BR-08 | At most 5 ◊ featured listings are shown first in any region/category result page; if more are active they rotate by weight-free round robin per request ◊. |
| BR-09 | Invoices: sequential `number` per calendar year, immutable once `paid`; corrections are `void` + new invoice. Labelled "Receipt — not a tax invoice" until D-10 is decided. |
| BR-10 | The payment port (`createOrder`, `capture/verify`, `refund`) is the only code that talks to a provider. Webhooks (gateway) are verified by signature and are idempotent by provider event ID. |
| BR-11 | Booking fee settings: `percent` 0–20, `flatMinor` ≥ 0, `capMinor` null or ≥ `flatMinor`. Cannot be enabled in production without a non-manual provider (AC-19). |
| BR-12 | All amounts are integer minor units in INR (ADR-0017). |

## 4. Workflows

**Purchase** — Plans page (comparison table; current plan marked;
recommended plan emphasised) → *Choose* → confirm sheet (price, period,
what changes now) → checkout → success state with new entitlements →
invoice link.

**Featured** — Subscription page → *Feature a vehicle* → vehicle, region,
start date, days → shows "N days from your plan" or the price → confirm.

**Admin** — Plans list → edit form with entitlement fields → save; Settings →
Booking fee.

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Gateway returns `requires_action` (R1.1) | Hosted checkout opens with `providerOrderId` / `providerPublicKey`; on return the client polls `GET /driver/subscription` until `active` or timeout; a webhook is the source of truth |
| ALT-2 | Payment fails (R1.1) | Subscription stays as it was; invoice `open` → `void` after 30 min ◊ |
| ALT-3 | Lapse with too many vehicles | Banner asks which vehicle to keep listed |
| ALT-4 | Cancel then change mind before period end | Buying the same plan again re-enables auto-renew (new idempotency key) |
| ALT-5 | Featured dates overlap an existing placement | Form shows the conflict; server returns `409` |

## 5. Loading, empty, error, retry and offline states

| State | Behaviour |
| --- | --- |
| Loading | Plan cards skeleton; subscription summary skeleton |
| Empty | Invoices: "No invoices yet". Featured: explanation + CTA |
| Error | Checkout failure states what happened and that no charge was made (manual) / "we're confirming your payment" (gateway, unknown outcome) |
| Retry | Checkout and featured purchase retry with the **same** idempotency key until a definitive response |
| Offline | Plans readable from cache; purchase actions disabled |

## 6. API and database changes

| Operation | Request → response | Access |
| --- | --- | --- |
| `GET /plans` | — → `SubscriptionPlan[]` | public |
| `GET /driver/subscription` | — → `DriverSubscription` | driver |
| `POST /driver/subscription/checkout` (idem) | `SubscriptionCheckoutRequest` → `CheckoutSession` | driver |
| `POST /driver/subscription/cancel` | — → `DriverSubscription` | driver |
| `GET /driver/invoices` | `PageQuery` → `Paginated<Invoice>` | driver |
| `GET` · `POST /driver/featured-placements` (idem on POST) | — / `PurchaseFeaturedPlacementRequest` → `FeaturedPlacement[]` / `FeaturedPlacement` | driver |
| `GET` · `POST /admin/plans` | — / `SubscriptionPlanInput` → `SubscriptionPlan[]` / `SubscriptionPlan` | `plans.manage` |
| `PUT /admin/plans/{planId}` | `SubscriptionPlanInput` → `SubscriptionPlan` | `plans.manage` |
| `GET` · `PUT /admin/settings` | — / `PlatformSettingsUpdate` → `PlatformSettings` | `settings.read` / `settings.manage` |

Tables: `plans`, `subscriptions` (partial unique: one current per partner),
`invoices` (unique `number`), `featured_placements` (exclusion on overlapping
ranges per vehicle + region), `platform_settings`. Jobs:
`subscription-renewal` (hourly), `featured-status` (daily 00:05 IST).

## 7. Authorisation and security

- Partner routes act only on the caller's own subscription, invoices,
  vehicles and placements.
- Plan management: `plans.manage` (`super_admin`, `finance_manager`).
  Booking fee: `settings.manage` (`super_admin` only).
- Price integrity: the client never sends an amount; the server derives it
  from the plan or the per-day price. Idempotency prevents double charges.
- Gateway (R1.1): secrets only in the secret store; webhook signature
  verification; no card data ever touches Payana (hosted checkout).
- All purchases and plan changes are audited.

## 8. Validation rules

| Field | Rule |
| --- | --- |
| `SubscriptionCheckoutRequest.planId` | UUID of an active plan |
| `PurchaseFeaturedPlacementRequest.vehicleId` | caller's operable vehicle |
| `regionSlug` | `live` region in the partner's `serviceAreas` |
| `startsOn` | ISO date, today (IST) or later, ≤ 90 days ahead |
| `days` | integer 1–30 |
| `SubscriptionPlanInput.code` | `^[a-z][a-z0-9_]{1,29}$`, unique, immutable |
| `name` / `description` | 1–40 / ≤ 300 chars |
| `price.amountMinor` | integer ≥ 0 (0 only for `free`), INR |
| `billingPeriod` | `BillingPeriod` |
| `entitlements.maxVehicles` | 1–50 |
| `entitlements.monthlyQuoteLimit` | null or 1–100 000 |
| `entitlements.featuredDaysIncluded` | 0–31 |
| `entitlements.badge` | null or 1–12 chars |
| `highlights` | 0–8 items of 1–80 chars |
| `BookingFeeSettings.flatMinor` | integer 0–100 000 |
| `percent` | 0–20, ≤ 2 decimals |
| `capMinor` | null or integer ≥ `flatMinor` |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F11-01 | Unit | Entitlement evaluator for vehicles, quotes, featured days, across plan changes and period boundaries (IST month) |
| UT-F11-02 | Unit | Period arithmetic for monthly / quarterly / yearly incl. month-end dates |
| UT-F11-03 | Unit | Subscription state machine incl. `past_due` grace |
| UT-F11-04 | Unit | Featured placement overlap and allowance rule (BR-07) |
| UT-F11-05 | Unit | Invoice numbering across a year boundary |
| UT-F11-06 | Unit | Manual payment adapter contract test (shared suite every adapter must pass) |
| IT-F11-01 | Integration | Plans list; default free subscription (AC-01, 02) |
| IT-F11-02 | Integration | Checkout, idempotency, invoice, notification (AC-03, 04, 06) |
| IT-F11-03 | Integration | Flag off (AC-05) |
| IT-F11-04 | Integration | Lapse → unlisting; quote limit (AC-07, 08) |
| IT-F11-05 | Integration | Cancel auto-renew and renewal job with time travel (AC-09, 10) |
| IT-F11-06 | Integration | Featured: allowance, paid, invalid cases, search effect (AC-12…15) |
| IT-F11-07 | Integration | Admin plan edit snapshot semantics; deactivation (AC-16, 17) |
| IT-F11-08 | Integration | Booking-fee settings and production guard (AC-18, 19) |
| E2E-F11-01 | E2E | Driver upgrades in test mode, sees the badge on their public listing |
| NT-F11-01 | Negative | Permission matrix (AC-20); cross-partner invoices/placements |
| NT-F11-02 | Negative | Missing idempotency key on both `(idem)` routes |
| NT-F11-03 | Negative | Client-supplied amount is ignored / rejected as unknown property |

## 10. Performance and accessibility

- Checkout (manual) p95 ≤ 600 ms; entitlement checks add ≤ 5 ms to quote and
  vehicle operations (cached per partner for 60 s, invalidated on change).
- Plan comparison is a real table on desktop and stacked cards on mobile
  with the same reading order; "Recommended" and "Current plan" are text;
  prices are read as "₹299 per month".
- Confirm sheets are modal dialogs with focus management; the test-mode
  label is text, not colour.

## 11. Deployment, rollback and observability

- **Seed** (illustrative, D-12): `free` (₹0, 1 vehicle, 30 quotes/month),
  `plus` (monthly, 2 vehicles, 150 quotes, priority, 3 featured days, badge
  "Plus"), `pro` (monthly, 5 vehicles, unlimited quotes, priority, 7 featured
  days, analytics, badge "Pro").
- **Config**: `PAYMENT_PROVIDER` (`manual` | `razorpay`), per-day featured
  price ◊ (₹49), grace days.
- **Flags**: `FeatureFlag.Subscriptions`, `FeatureFlag.FeaturedListings`.
  **Rollback**: flags off freeze purchases; existing entitlements continue.
- **Metrics**: checkouts started / completed; active subscriptions by plan;
  MRR (sum of snapshot prices normalised to monthly); churn; featured days
  sold vs. from allowance; entitlement-exceeded events.
- **Audit**: `subscription.purchased|cancelled|renewed|expired`,
  `featured.purchased`, `plan.created|updated`, `settings.updated`.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | **No refund, reconciliation, coupon or financial-report operations or types** (FR-SUB-011…013), though permissions `refunds.process`, `payments.reconcile`, `reports.financial` exist. |
| G-2 | No price for a featured day anywhere in the contract (`PurchaseFeaturedPlacementRequest` returns no amount; `FeaturedPlacement` has no price). The per-day price is server configuration and is surfaced only on the resulting invoice. |
| G-3 | No webhook route in `ApiRoutes` for a gateway (needed at R1.1). |
| G-4 | `Invoice` has no tax fields, no line items and no link to what was bought beyond `description`. |
| G-5 | `DriverSubscription` does not expose the snapshot entitlements separately from `plan`; assumed `plan` in the response reflects the snapshot. |
| G-6 | No admin operation to view a partner's subscription or grant a complimentary plan. |
| A-1 | Upgrade/downgrade timing, grace days, featured caps and the per-day price are defaults. |
| A-2 | The `free` plan is permanent and cannot be deactivated. |
