# ADR-0004 — Administrator MFA with TOTP

*Status: accepted · 2026-11-10 · Source: brief §5.C ("stronger authentication for privileged users, and use MFA where supported")*

## Context

Administrators can view identity documents, suspend accounts, change
configuration and — for `super_admin` — create other administrators. A
compromised admin account is the most damaging single event in the threat
model (T-08). Customers and drivers sign in by phone OTP; that is not strong
enough for staff, and staff should not depend on SMS delivery.

## Decision

1. Administrators sign in with **email + password** (Argon2id, minimum
   `ADMIN_PASSWORD_MIN_LENGTH`) and then a **TOTP** code (RFC 6238, 6 digits,
   30 s step, ±1 step tolerance, each code accepted once).
2. MFA is **mandatory for every `AdminRole`**; it can never be disabled for
   `super_admin`. A member without an enrolled factor receives
   `mfa_enrollment_required` with `otpauthUrl` and `secret` and must verify a
   code before any session is issued.
3. The password step yields only a short-lived, single-purpose `mfaToken`;
   no session exists until the second factor verifies.
4. TOTP secrets are encrypted at rest with a key from the secret store.
5. Failures lock the account temporarily and are audited; unknown email and
   wrong password are indistinguishable.
6. There is **no self-service reset** of password or factor at R1: another
   `super_admin` suspends and re-creates the account.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Phone OTP for admins | SIM-swap risk; ties privileged access to SMS availability |
| WebAuthn / passkeys | Strongest option; more client and recovery work than R1 allows — the intended next step, additive to TOTP |
| Corporate SSO (OIDC) | No identity provider exists for the operator yet; the admin auth adapter keeps this open |
| MFA only for `super_admin` | Verification officers see identity documents; support can suspend accounts — both warrant a second factor |
| Email magic links | Mailbox compromise equals admin compromise; adds an email dependency |

## Consequences

- **Good**: phishing-resistant enough for launch; no vendor dependency;
  works offline for the code generator.
- **Cost**: staff need an authenticator app; lost devices need a second
  `super_admin` — so at least two must exist before launch (release plan).
- **Gap**: the contract has no change-password or factor-reset operation
  (F-01 G-1); temporary passwords persist until one is added.
- **Later**: passkeys as an additional factor; step-up prompts for the most
  sensitive actions (staff changes, `requireConsent` off).
