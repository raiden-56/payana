# ADR-0001 — Modular monolith with an extraction path

*Status: accepted · 2026-11-10 · Source: brief §3*

## Context

One town at launch, a small team, unknown demand, and a brief that says
"avoid premature microservices" while requiring that services can be
extracted "when actual scale requires it". The domain has clear areas —
identity, catalogue, marketplace, bookings, commerce, engagement,
administration — that share one transactional core (accepting a quote touches
requests, quotes, bookings, entitlements and fees at once).

## Decision

Build **one deployable NestJS API** composed of modules `identity`,
`catalog`, `marketplace`, `bookings`, `commerce`, `engagement`, `admin` and
`platform`, each with `domain / application / infrastructure / presentation`
layers. Rules:

1. A module exports only application services; repositories and ORM entities
   are private.
2. No module reads or joins another module's tables.
3. Synchronous needs go through exported services; reactions go through
   domain events in a transactional outbox.
4. One PostgreSQL database with module-owned tables (prefix-free, ownership
   documented in the data model).
5. Boundaries are checked by an import-boundary lint rule and an
   architecture test.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Microservices from day one | Distributed transactions for quote acceptance, operational cost, and no evidence of scale; contradicts the brief |
| Unstructured monolith | Cheap now, but makes later extraction a rewrite and lets authorisation and privacy rules scatter |
| Serverless functions per endpoint | Cold starts on the OTP and accept paths; connection management to PostgreSQL; harder local development |
| Separate databases per module inside one process | Loses the single transaction that makes acceptance safe, with no present benefit |

## Consequences

- **Good**: one transaction for booking-critical writes; one deployment;
  simple local development; low cost.
- **Cost**: discipline is required to keep boundaries — enforced by tooling,
  not goodwill.
- **Accepted coupling**: foreign keys cross module boundaries for integrity;
  code never navigates them.
- **Extraction path** (system design §11): worker process → notifications →
  discovery read model → commerce → identity, each triggered by a measured
  need. Nothing in R1 blocks any step.
- **Scaling until then**: horizontal API tasks (stateless), read replica,
  Redis caches.
