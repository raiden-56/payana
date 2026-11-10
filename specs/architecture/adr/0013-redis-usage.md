# ADR-0013 — What Redis is and is not used for

*Status: accepted · 2026-11-10 · Source: brief §4 ("Redis for caching, rate limiting, temporary availability state, and job coordination when required")*

## Context

The brief allows Redis "when required". Used loosely, a cache becomes a
second source of truth that nobody backs up. The API runs as several
stateless tasks that must share a few kinds of short-lived state.

## Decision

Redis holds **only ephemeral, reconstructible state**. PostgreSQL remains the
single source of truth.

| Use | Key family | TTL | If Redis is lost |
| --- | --- | --- | --- |
| Rate limiting (OTP, login, public endpoints, ad events) | `rl:*` | window length | Counters reset; OTP and admin login **fail closed** while Redis is unreachable (NFR-REL-004) |
| OTP / login lockouts | `lock:auth:*` | lock duration | Lockouts lifted — acceptable, limits re-accumulate |
| Session-revocation flags | `sess:revoked:*` | ≤ access-token lifetime | Fallback: check `sessions.revoked_at` in PostgreSQL |
| Used TOTP codes (anti-replay) | `totp:*` | 90 s | Brief replay window; mitigated by login rate limits |
| Idempotency in-flight markers | `idem:*` | 30 s | Durable record is in `idempotency_keys`; only concurrent-duplicate serialisation degrades |
| Scheduled-job locks | `lock:job:*` | job timeout | A job may run twice — every job is idempotent |
| Short caches (catalogue, public config, entitlements, eligible ads, admin overview) | `cache:*` | 60 s | Recomputed from PostgreSQL |

**Not in Redis**

- **Driver availability and last position.** The brief mentions "temporary
  availability state"; these are instead rows in PostgreSQL
  (`driver_profiles.availability`, `driver_locations`) because search joins
  them with eligibility and uses the PostGIS index, and because they must
  survive a cache restart. Revisit only if write volume from location pings
  becomes a measured problem (then: Redis GEO as a write-behind buffer).
- **Sessions, OTP challenges, outbox, queues.** Durable; PostgreSQL.
- **A job queue.** The outbox table plus in-process workers serve R1
  (system design §7); a managed queue arrives with the first extraction.

Operational rules: a key-prefix per environment; no `KEYS` in application
code; every key has a TTL; values are small JSON; Redis is deployed without
persistence requirements (ElastiCache, in-transit encryption, private).

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| No Redis; rate limits in PostgreSQL | Write-heavy counters on the primary; awkward expiry; poorer latency on the hottest abuse path |
| In-memory limits per API task | Limits multiply by task count and reset on deploy |
| Redis as primary store for location/availability | Loses joins and durability; two sources of truth for "who is listed" |
| BullMQ on Redis for jobs | Adds a durable dependency on Redis; the outbox already gives transactional enqueue |

## Consequences

- **Good**: Redis can be flushed or replaced at any time without data loss;
  clear failure behaviour.
- **Cost**: availability and location writes hit PostgreSQL (one upsert per
  ping) — sized for R1 (≤ 5 000 drivers × one ping / 30 s while in
  foreground).
- **Test**: integration tests run against a real Redis; a fault-injection
  test covers the fail-closed and fail-open paths.
