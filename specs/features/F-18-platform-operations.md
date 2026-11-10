# F-18 — Platform operations (observability, CI/CD, infrastructure as code)

| | |
| --- | --- |
| Requirements | FR-OPS-001 … FR-OPS-016; NFR-OBS, NFR-REL, NFR-SEC-002/003/007/009/010, NFR-MAINT |
| Priority / release | P0 (FR-OPS-011, 013 P1) · R1 |
| Contract | `common.ts` (`ProblemDetails`, `ErrorCode`, `FieldError`, `IDEMPOTENCY_KEY_HEADER`, `REQUEST_ID_HEADER`, `PageQuery`, `Paginated`); `ApiRoutes.health.*`, `API_PREFIX` |
| API module | `apps/api/src/modules/platform` and the application bootstrap |
| Infra | `docker-compose.yml`, `infra/terraform`, `.github/workflows` |
| ADRs | 0001 modular monolith · 0002 TypeORM + migrations · 0013 Redis · 0016 repo layout |

## 1. Business objective and scope

The cross-cutting machinery every feature relies on, and the means to build,
ship, run and diagnose the system: one way to validate, fail, log, audit,
limit, deduplicate, schedule and deploy.

**In scope** — health endpoints; request IDs and structured logging; the
error envelope; validation pipeline; OpenAPI generation and drift check;
migrations; idempotency infrastructure; outbox and scheduled jobs; rate
limiting; audit service; configuration and secrets; seed data; local Docker
Compose; CI quality gates; Terraform definitions; metrics and tracing.
**Out of scope** — the business behaviour of each job (owned by feature
specs); on-call organisation.

## 2. User stories and acceptance criteria

- **US-01** As an engineer, one command gives me a working local stack.
- **US-02** As a client developer, every error has the same shape and a
  stable code.
- **US-03** As on-call, I can follow one request through the logs.
- **US-04** As the operator, a retried payment or booking never doubles.
- **US-05** As a reviewer, a change cannot merge with failing gates.

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-F18-01 | the API process is up | `GET /health/live` | `200 { "status": "ok" }` without touching dependencies |
| AC-F18-02 | PostgreSQL or Redis is unreachable | `GET /health/ready` | `503` with `checks` naming the failing dependency; with both reachable (and migrations current) `200 { status, checks }`; the load balancer uses this probe |
| AC-F18-03 | any request | it completes | the response carries `x-request-id` (the inbound value if it is a valid UUID/ULID, otherwise a generated one) and exactly one JSON log line exists with the fields of NFR-OBS-001 |
| AC-F18-04 | any failure — validation, auth, not found, conflict, rate limit, unhandled exception | the response is returned | `Content-Type: application/problem+json`; body is `ProblemDetails` with `type`, `title`, `status`, `code` ∈ `ErrorCode`, `traceId` = request ID; unhandled errors return `500 internal_error` with no stack trace, SQL, or internal message |
| AC-F18-05 | a body with a wrong type, a missing required field and an unknown property | any endpoint | `400 validation_failed` with one `FieldError` per problem (dot-path `field`); no partial processing |
| AC-F18-06 | an `(idem)` route | called without `Idempotency-Key` / twice with the same key and body / with the same key and a different body / twice concurrently | `400 idempotency_key_required` / same status and body both times with one side effect / `409 idempotency_key_reused` / one executes, the other waits and returns the stored response (or `409 conflict` if still in flight after 5 s ◊) |
| AC-F18-07 | the API is running | `GET /api/v1/docs` (non-production) and `npm --prefix apps/api run openapi:export` | Swagger UI renders; the export writes `specs/api/openapi.yaml`; every path in `ApiRoutes` appears with its method(s), request/response schemas and security requirement |
| AC-F18-08 | a change alters a route or DTO without re-exporting | CI runs | the OpenAPI drift check fails |
| AC-F18-09 | an empty PostgreSQL 17 + PostGIS database | migrations run, then run again | schema is created; the second run is a no-op; `npm run api:seed` is idempotent and yields regions, categories, places, plans, packages, default settings and the first `super_admin` |
| AC-F18-10 | a limit from NFR-SEC-007 is exceeded | another request arrives | `429 rate_limited` with `retryAfterSeconds` and a `Retry-After` header; counters are shared across API instances (Redis) |
| AC-F18-11 | two API instances | a scheduled job is due | it runs exactly once (distributed lock); its duration and outcome are logged and counted; an overrunning job does not start a second copy |
| AC-F18-12 | a use case calls the audit service inside its transaction | the transaction commits / rolls back | the audit row exists / does not exist; rows cannot be updated or deleted by the application role |
| AC-F18-13 | a fresh clone on a machine with Docker and Node 24 | `npm run setup && npm run infra:up && npm run api:migrate && npm run api:seed && npm run api:dev` and `npm run web:dev` | the API answers `/api/v1/health/ready` with `200` and the web app loads against it; host ports do not collide with a local PostgreSQL on 5432 (compose maps 5439 / 6380 by default) |
| AC-F18-14 | a pull request | CI runs | jobs: contracts build · API lint, type-check, unit, integration (PostgreSQL + PostGIS and Redis service containers), OpenAPI drift · web lint, type-check, unit, build with budgets, palette check · e2e smoke · dependency audit · secret scan — and the PR cannot merge unless all pass |
| AC-F18-15 | the Terraform configuration | `terraform validate` and `terraform plan` against an empty workspace with example variables | both succeed and plan the resources in §3.3; no secret value appears in the configuration or the plan output |
| AC-F18-16 | a required environment variable is missing or malformed | the API starts | start-up fails fast with a message naming the variable (never its value); the same schema documents every variable in `.env.example` |
| AC-F18-17 | SIGTERM during traffic | the process receives it | it stops accepting new requests, finishes in-flight ones (≤ 25 s ◊), stops the outbox worker and jobs cleanly, closes pools, and exits 0 |
| AC-F18-18 | the metrics endpoint (internal) | scraped | the series of NFR-OBS-002 exist with route-template labels (never raw paths or IDs) |

## 3. Preconditions, postconditions and business rules

### 3.1 Request pipeline (order is normative)

1. Request ID → 2. Security headers / CORS → 3. Body size limit (100 kB ◊
   JSON; uploads go to storage, not through the API, except the local-disk
   adapter) → 4. Rate limit → 5. Authentication → 6. Account status →
   7. Role / permission → 8. Idempotency (for `(idem)` routes) →
   9. Validation and transformation (allow-list) → 10. Controller → use
   case (transaction, audit, outbox) → 11. Response serialisation →
   12. Exception filter → `ProblemDetails` → 13. Access log.

### 3.2 Scheduled jobs

| Job | Cadence ◊ | Owner spec |
| --- | --- | --- |
| `request-expiry`, `quote-expiry` | every minute | F-07 |
| `outbox-worker` | continuous (1 s poll) | F-15 |
| `document-expiry` + reminders | daily 01:00 IST | F-05 |
| `authorization-expiry` | daily 01:10 IST | F-04 |
| `subscription-renewal` | hourly | F-11 |
| `featured-status`, `campaign-status` | daily 00:05 IST | F-11, F-12 |
| `account-erasure` | daily 02:30 IST | F-02 |
| `retention-purge` (OTP, idempotency keys, sessions, ad events, notifications, outbox) | daily 03:00 IST | NFR-PRIV-003 |
| `stuck-booking-flag` | hourly | F-08 |

### 3.3 Infrastructure (AWS, Terraform)

| Concern | Resource |
| --- | --- |
| Network | VPC across 2 AZs; public subnets (ALB), private subnets (ECS, RDS, ElastiCache); NAT; security groups least-privilege |
| API compute | ECS Fargate service (≥ 2 tasks), ALB with HTTPS (ACM), health check on `/api/v1/health/ready`, rolling deploy with circuit breaker, autoscaling on CPU and request count |
| Database | RDS PostgreSQL 17, Multi-AZ in production, encrypted, automated backups + PITR, `postgis` extension enabled by migration, private only |
| Cache | ElastiCache (Redis-compatible), private, in-transit encryption |
| Files | S3 private bucket (versioned, SSE, public access blocked, lifecycle for orphan uploads), presigned access |
| Web | S3 + CloudFront (OAC), SPA fallback to `index.html`, response-headers policy for CSP/HSTS, long cache for hashed assets, `no-cache` for `index.html`, service worker and manifest |
| Secrets | Secrets Manager (JWT keys, hash keys, TOTP key, DB credentials, SMS / payment credentials later); task role reads only its own |
| Images | ECR with scan-on-push and lifecycle policy |
| Observability | CloudWatch log groups with retention, metric filters/alarms per NFR-OBS-004, dashboard |
| Environments | `staging` and `production` workspaces from the same modules; state in S3 with locking |
| Region | `ap-south-1` (NFR-PRIV-007) |

### 3.4 Rules

| # | Rule |
| --- | --- |
| BR-01 | `code` is the contract for clients; `title`/`detail` are human text and may change. New codes are added to `ErrorCode` in `packages/contracts` first. |
| BR-02 | Validation rejects unknown properties and coerces only declared query/path types. |
| BR-03 | Idempotency records: key scope = user + method + route template; store request hash, status, body; TTL 24 h; in-flight marker so concurrent duplicates serialise. |
| BR-04 | Transactions are opened by the application layer (use case), not by controllers or repositories; audit and outbox writes join them. |
| BR-05 | Configuration is read once at start-up through a validated schema; no `process.env` access elsewhere. Secrets are referenced by name; `.env` files are for local development only and are git-ignored. |
| BR-06 | Logs are JSON to stdout; no personal data (NFR-PRIV-005); levels: `error` (needs action), `warn`, `info` (one per request + lifecycle), `debug` (off in production). |
| BR-07 | Migrations are forward-only SQL/TypeORM migrations, reviewed, expand-then-contract, run as a separate one-off task before the new version receives traffic (NFR-REL-006). |
| BR-08 | Every module exposes only its public service interfaces; an import-boundary lint rule enforces NFR-SCAL-004. |
| BR-09 | The repository uses independent `package.json`s (no npm workspaces) for `packages/contracts`, `apps/api`, `apps/web`; contracts are consumed as a built file dependency (ADR-0016). |
| BR-10 | Dependencies are exact-pinned; Node `>=24 <25`; TypeScript 6.0 (constitution §7). |
| BR-11 | CI is the only path to deployment; production deploys require a manual approval and a successful staging smoke run. |

## 4. Workflows

**Local** — AC-F18-13.
**Change** — branch → code + spec + tests → PR → CI gates → review → merge →
image build → staging: migrate, deploy, smoke e2e → approval → production:
migrate, rolling deploy, post-deploy checks.
**Incident** — alert → dashboard → request ID from the user-visible `traceId`
→ logs/traces → fix or roll back (release plan §5, §10).

| # | Alternative | Behaviour |
| --- | --- | --- |
| ALT-1 | Migration fails in staging | Pipeline stops; no deploy; database is restored from the pre-migration snapshot if partially applied |
| ALT-2 | New tasks fail health checks | ECS circuit breaker rolls back to the previous task definition automatically |
| ALT-3 | Redis outage | Per NFR-REL-004: auth fails closed, public reads continue for a bounded time |
| ALT-4 | Docker not running locally | `npm run infra:up` fails with a message telling the developer to start Docker |
| ALT-5 | Port 5439 / 6380 taken | Override with `PG_HOST_PORT` / `REDIS_HOST_PORT` |

## 5. Loading, empty, error, retry and offline states

Operational equivalents:

| State | Behaviour |
| --- | --- |
| Starting (loading) | Readiness is `503` until configuration is validated, pools are connected and migrations are confirmed current |
| Empty database | Migrate + seed produce a usable system; readiness reports a pending migration as not ready |
| Error | Uniform `ProblemDetails`; unhandled errors are logged with stack (server side only) and counted |
| Retry | Clients: per F-17 BR / AC-12. Server: outbox and jobs retry with back-off; HTTP calls to providers use timeouts (5 s ◊) and at most 2 retries on idempotent calls |
| Dependency offline | Readiness fails; alarms fire; behaviour per NFR-REL-004 |

## 6. API and database changes

| Operation | Response | Access |
| --- | --- | --- |
| `GET /health/live` | `{ status: "ok" }` | public |
| `GET /health/ready` | `{ status, checks }` | public |

Tables: `idempotency_keys`, `outbox_events`, `audit_logs`,
`platform_settings`, TypeORM `migrations`. Redis key families: `rl:*` (rate
limits), `lock:*` (job locks), `idem:*` (in-flight markers), `cache:*`
(catalogue, config, entitlements), `sess:*` (revocation cache), `otp:*`.

## 7. Authorisation and security

- Default-deny routing (NFR-SEC-002): each handler declares `public`, `user`,
  a role, or a permission; undeclared handlers fail start-up.
- Health endpoints reveal dependency names and up/down only — no versions,
  hosts or error text.
- Swagger UI is disabled in production; the exported document is public in
  the repository and contains no secrets or examples with real data.
- Supply chain: lockfiles, `npm ci`, audit gate, secret scanning, pinned
  GitHub Actions by commit SHA, least-privilege CI credentials (OIDC to AWS,
  no long-lived keys).
- Containers run as non-root with a read-only root filesystem; images are
  scanned on push.
- Terraform state is encrypted and access-controlled; no secrets in
  variables files committed to the repository (only `*.tfvars.example`).

## 8. Validation rules

| Item | Rule |
| --- | --- |
| `x-request-id` (inbound) | accepted if 8–64 chars `[A-Za-z0-9-]`; otherwise replaced |
| `Idempotency-Key` | 16–100 chars `[A-Za-z0-9_-]` |
| `page` / `pageSize` | integer ≥ 1 / 1–`MAX_PAGE_SIZE` (default `DEFAULT_PAGE_SIZE`) |
| JSON body size | ≤ 100 kB ◊ |
| Environment schema | every variable typed; URLs, ports, durations and enumerations validated; production forbids development adapters (SMS, payment-with-fee, storage `local`) |
| Dates | ISO-8601; date-times must include an offset or `Z` |

## 9. Test cases

| ID | Level | Case |
| --- | --- | --- |
| UT-F18-01 | Unit | Exception filter maps each error class to status + `ErrorCode`; never leaks internals |
| UT-F18-02 | Unit | Validation pipe: unknown property, wrong type, nested path names |
| UT-F18-03 | Unit | Idempotency service: store, replay, mismatch, in-flight |
| UT-F18-04 | Unit | Configuration schema: missing / malformed / production-forbidden values (AC-16) |
| UT-F18-05 | Unit | Log redaction: phone, email, token, coordinate patterns never emitted |
| IT-F18-01 | Integration | Health live/ready with dependencies up and down (AC-01, 02) |
| IT-F18-02 | Integration | Request ID propagation and single access-log line (AC-03) |
| IT-F18-03 | Integration | Error envelope across error classes (AC-04, 05) |
| IT-F18-04 | Integration | Idempotency incl. concurrency (AC-06) |
| IT-F18-05 | Integration | Rate limiting shared across two app instances (AC-10) |
| IT-F18-06 | Integration | Job lock with two instances (AC-11) |
| IT-F18-07 | Integration | Audit atomicity and immutability (AC-12) |
| IT-F18-08 | Integration | Migrations from empty and twice; seed idempotent (AC-09) |
| IT-F18-09 | Contract | Exported OpenAPI equals the committed file; every `ApiRoutes` path present; default-deny check lists zero undeclared routes (AC-07, 08) |
| IT-F18-10 | Integration | Graceful shutdown under load (AC-17) |
| E2E-F18-01 | E2E smoke | Fresh stack → sign in → search → request → quote → accept → complete (used in CI and after each deploy) |
| NT-F18-01 | Negative | Oversized body, malformed JSON, wrong content type → uniform 4xx envelope |
| NT-F18-02 | Negative | `terraform validate` fails on an introduced error; plan contains no secret literals (AC-15) |

## 10. Performance and accessibility

- Pipeline overhead (steps 1–9 without the handler) ≤ 10 ms p95.
- Outbox poll and job locks add negligible load (< 5 queries/s idle).
- CI wall-clock target ≤ 15 min for the PR pipeline ◊ (parallel jobs, caches).
- Accessibility does not apply to this feature directly; the CI gates it
  provides (axe, Lighthouse) enforce NFR-A11Y for the web client.

## 11. Deployment, rollback and observability

- **Deploy and rollback procedures**: `specs/deployment/release-plan.md`.
- **Dashboards**: API (RED per route), database, Redis, outbox/jobs,
  business funnel (requests → quotes → bookings).
- **Alerts**: NFR-OBS-004.
- **Runbooks** (release plan §10): failing readiness, outbox lag, OTP spike,
  database failover, rollback, restoring from PITR.

## 12. Gaps and assumptions

| # | Item |
| --- | --- |
| G-1 | Tracing (FR-OPS-013, NFR-OBS-003) and a metrics backend are P1: instrumentation points are specified; the collector/backend choice (CloudWatch EMF vs. OpenTelemetry collector) is open. |
| G-2 | No dedicated job runner/queue at R1; jobs run in-process in the API tasks with locks. A separate worker service is the first extraction candidate (ADR-0001). |
| G-3 | The contract defines no response type for `/health/ready` beyond a comment (`{ status, checks }`). |
| G-4 | Terraform is defined and validated in R1 but **not applied**; no cloud environment exists until credentials and an account are provided. |
| G-5 | No WAF / bot-management resource is defined; recommended before launch for OTP endpoints. |
| A-1 | Cadences, limits and timeouts marked ◊ are defaults. |
| A-2 | GitHub Actions is the CI system (constitution §7). |
