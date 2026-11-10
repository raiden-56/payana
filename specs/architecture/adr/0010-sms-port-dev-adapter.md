# ADR-0010 — SMS port with a development adapter

*Status: accepted · 2026-11-10 · Source: brief §5.A-1, §6 Module 1 (phone OTP)*

## Context

Sign-in is by SMS one-time code. Sending transactional SMS in India requires
the sender entity, header and message template to be registered on a DLT
platform (TRAI), and a contract with an SMS provider — owner decision D-02,
with a lead time the build cannot wait for. OTP endpoints are also the
product's most abusable surface (SMS pumping, T-01).

## Decision

1. Define an **`SmsSender` port** (`send(to, templateKey, variables)`) used by
   identity (OTP) and, later, notifications.
2. Ship a **development adapter** that sends nothing and makes the code
   available to the caller through `OtpChallenge.devCode`, and logs a
   structured "would send" line with the phone masked.
3. **Fail-safe**: the API refuses to start with `NODE_ENV=production` and the
   development adapter selected; `devCode` is never serialised in production.
4. A **gateway adapter** (for example MSG91, Gupshup, Twilio or AWS SNS with a
   DLT route — provider undecided) is added at R1.1 behind the same port,
   carrying the DLT template ID in configuration.
5. Cost and abuse controls live **in front of** the port and are identical
   for every adapter: per-phone and per-IP limits, resend cooldown, lockouts,
   a global circuit breaker on send rate, and an alert on spikes.
6. OTP delivery is the only SMS use at R1. Notification SMS (F-15) waits for
   the real adapter and its own templates.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Integrate a provider now | No DLT registration or credentials exist; untestable |
| Firebase phone auth | Outsources OTP and abuse controls to a third party SDK in the client; couples identity to a vendor; still subject to regional delivery rules |
| WhatsApp OTP | Requires a WhatsApp Business account and template approval; a good **additional** channel later through the same port |
| Email OTP | Many target users have no email habit; the brief specifies phone OTP |
| Fixed test code (e.g. 000000) | A backdoor that tends to reach production; echoing the real generated code keeps the whole flow honest |

## Consequences

- **Good**: the full OTP flow, rate limiting and lockout are built and
  tested now; the provider is a configuration change later.
- **Cost**: R1 cannot authenticate real users on real phones — a stated
  launch blocker (release plan §8).
- **Risk**: an environment misconfigured as non-production would echo codes;
  mitigated by the start-up guard keyed on `NODE_ENV`, by infrastructure
  setting it explicitly, and by a smoke test asserting `devCode` is absent in
  staging and production.
- **Open**: international numbers (D-09) need a provider and route decision
  as well as a contract change (`INDIAN_MOBILE_E164`).
