# ADR-0009 — Payment port with a manual adapter first

*Status: accepted · 2026-11-10 · Source: brief §1 item 5, §3 (idempotent payment workflows), §5.C-7*

## Context

Subscriptions, featured placements and (optionally) a booking fee are paid
to the platform. Taking real payments in India requires a registered
business, a bank account and gateway KYC — owner decision D-01, not yet
made. Trip fares are paid directly to drivers and never pass through the
platform (assumption A-02).

## Decision

1. Define a **`PaymentGateway` port** in `commerce`:
   `createOrder(amount, reference, idempotencyKey)`, `verify/capture`,
   `refund`, and webhook verification. Use cases depend on the port only.
2. Ship **`PaymentProvider.Manual`** as the R1 adapter: no money moves;
   `createOrder` completes immediately; the invoice is marked `paid` with
   provider `manual` ("settled offline").
3. `PaymentProvider.Razorpay` is the reserved second adapter (hosted
   checkout; no card data touches Payana). It is **not implemented** in R1.
4. Checkout and featured-placement purchase are **idempotent**
   (`Idempotency-Key`), and the server derives every amount — the client
   never sends one.
5. Guards against misuse of the manual adapter:
   - Non-production UIs label checkout "Test mode — no payment taken".
   - In a production environment, enabling the booking fee while the provider
     is `manual` is refused (F-11 AC-19).
   - The release plan lists a real adapter as a blocker for selling plans.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Integrate a gateway now | Needs credentials and KYC that do not exist; would be untestable and speculative |
| Leave subscriptions out until payments exist | Violates "do not silently remove features"; entitlements, invoices and renewal logic are independent of the provider and worth building and testing now |
| Free plans only | Hides the monetisation model from testing and from the owner |
| UPI intent links / QR without a gateway | No server-verifiable confirmation; manual reconciliation at scale |

## Consequences

- **Good**: the whole subscription lifecycle is built and tested; swapping
  the provider is a new adapter plus a webhook route.
- **Cost**: R1 revenue features are functionally complete but commercially
  inert; this is stated wherever they appear.
- **Gaps** to close with the gateway: webhook route, refund and
  reconciliation operations, tax fields on invoices (F-11 §12, D-10).
- **Testing**: a shared adapter contract test suite must pass for every
  adapter, so the gateway adapter is verified against the same behaviour.
