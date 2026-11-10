# ADR-0017 — Money as integer minor units

*Status: accepted · 2026-11-10 · Source: constitution §2.9; brief §3 (idempotent payment workflows)*

## Context

Fares, rates, fees, plan prices and invoices are amounts of Indian rupees.
Floating-point rupees accumulate rounding error, and JSON numbers are
doubles. Drivers think and type in whole rupees.

## Decision

1. Every amount on the wire, in code and in the database is an **integer
   number of minor units** (paise) with an explicit currency:
   `Money { amountMinor: number; currency: "INR" }`. `45000` = ₹450.00.
2. Request fields that are amounts are named with a `Minor` suffix
   (`fareMinor`, `perKmMinor`, `flatMinor`, `capMinor`) so the unit is
   never ambiguous.
3. Database columns are `integer` (or `bigint` for totals) named
   `*_minor`, with a `currency` column where a table can in principle hold
   more than one. No `numeric`/`float` for money.
4. **Arithmetic happens on the server in integers.** Percentages
   (booking fee) are computed as `round(percent × amount / 100)` with
   half-up rounding to the paisa, then any cap applied. The client never
   computes an amount that is later trusted.
5. **Presentation** converts at the edge: input fields accept rupees (whole
   rupees for quotes and rates — the UI multiplies by 100); display uses
   `en-IN` formatting (₹1,23,456) and omits `.00` for whole rupees.
6. Range limits are enforced in validation so values stay far inside the
   safe-integer range.
7. Analytics `value` parameters are rupees (major units), converted at the
   analytics adapter — the only place major units are produced for a machine.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Decimal rupees as JSON numbers | Binary floating-point error; ambiguous rounding |
| Decimal strings (`"450.00"`) | Exact, but every consumer must parse and every sum needs a decimal library |
| Whole rupees only | Cannot represent percentage fees or tax to the paisa |
| A money library on both sides | Unneeded weight for single-currency integer arithmetic |

## Consequences

- **Good**: exact arithmetic, trivial comparison and summation, unambiguous
  contract.
- **Cost**: every display and input must convert — centralised in one
  formatter/parser pair with unit tests, and in one shared validator.
- **Risk**: a field read as rupees by mistake is off by 100× — mitigated by
  the `Minor` naming rule, by `Money` being a distinct type, and by tests on
  the formatter.
- **Future**: a second currency is an additive change (`Currency` already
  exists); tax breakdowns (D-10) add fields, not a new representation.
