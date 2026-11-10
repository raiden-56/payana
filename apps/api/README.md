# Payana API

NestJS 12 modular monolith. REST under `/api/v1`, PostgreSQL 17 + PostGIS, Redis.
Every request and response type comes from [`packages/contracts`](../../packages/contracts) — the web client compiles against the same package.

## Run it locally

Prerequisites: Node 24, Docker Desktop running.

```bash
# from the repository root
docker compose up -d --wait postgres redis        # Postgres+PostGIS on :5439, Redis on :6380
npm --prefix packages/contracts ci && npm --prefix packages/contracts run build

cd apps/api
npm ci
cp .env.example .env                              # development values, safe to use as they are
npm run migration:run                             # schema + reference data (regions, places, categories, plans)
npm run seed                                      # optional demo data (development only)
npm run start:dev                                 # http://localhost:3000/api/v1  (Swagger UI: /api/docs)
```

If port 5439 or 6380 is taken, start compose with `PG_HOST_PORT=… REDIS_HOST_PORT=…` and change `DATABASE_URL` / `REDIS_URL` in `.env` to match.

### Signing in during development

| Who | How |
| --- | --- |
| Customer or driver | `POST /auth/otp/request` with any `+91XXXXXXXXXX` number. With `SMS_DRIVER=dev` the response contains the code as `devCode` (it is also logged). No SMS is sent. |
| Seeded customers | `+919000000201` … `205` |
| Seeded drivers | `+919000000101` … `114` approved, `115` waiting for verification, `116` changes requested |
| Staff | `super@`, `verify@`, `support@`, `finance@`, `marketing@payana.local` — password is `SEED_ADMIN_PASSWORD` (default `Payana-Dev-Admin-2026!`) |

Staff sign-in is two steps: `POST /auth/admin/login` (email + password) returns `mfa_required` and an `mfaToken`; `POST /auth/admin/mfa/verify` takes that token and a 6-digit authenticator code. The seeded staff share the TOTP secret in `SEED_ADMIN_TOTP_SECRET` (default `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`): add it to an authenticator app, or print the current code with

```bash
npm run totp
```

A code can be used once; wait for the next 30-second window to sign in again. A `super_admin` created without MFA is taken through enrolment on first sign-in (`mfa_enrollment_required` with an `otpauthUrl`).

Demo drivers' positions go stale after 15 minutes, as they would in real life. `DEMO_POSITION_HEARTBEAT=true` (development only) re-stamps the seeded "live" and "recent" drivers every minute so the demo keeps showing all four freshness states.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | API in watch mode |
| `npm run build` | Compile to `dist/` (`npm run clean` empties it first if you need a fresh build) |
| `npm run start:prod` | `node dist/main` |
| `npm run lint` / `npm run typecheck` | oxlint (type-aware) / `tsc --noEmit` |
| `npm test` | Unit tests — domain rules, no database |
| `npm run test:e2e` | End-to-end tests over HTTP against real Postgres + Redis. Recreates its own `payana_test` database and uses Redis database 1; never touches development data |
| `npm run migration:run` / `migration:revert` / `migration:status` | Apply / undo the latest / report migrations |
| `npm run seed` | Demo data. Idempotent. Refuses to run with `NODE_ENV=production` |
| `npm run totp` | Current authenticator code for the seeded staff |
| `npm run openapi:export` | Regenerate `specs/api/openapi.yaml` (needs Postgres and Redis up) |

## Configuration

All configuration is environment variables, parsed and validated at start-up (`src/config/env.ts`); a missing or malformed value stops the process. `.env` is read in development only. The full annotated list is in [`.env.example`](.env.example). The ones that matter most:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL`, `DATABASE_SSL`, `REDIS_URL` | Required. Database sessions run in `Asia/Kolkata` so calendar rules (document expiry, featured days) follow the market's date |
| `JWT_ACCESS_SECRET`, `SIGNING_SECRET` | Required, at least 32 characters each. Generate with `openssl rand -hex 32` |
| `DATA_ENCRYPTION_KEY` | Required, 32 bytes base64 (`openssl rand -base64 32`). Encrypts MFA secrets and document numbers at rest. **Losing or changing it makes that data unreadable** |
| `CORS_ORIGINS` | Comma-separated browser origins. `*` is refused in production |
| `COOKIE_SECURE` | `true` in production; `false` lets the refresh cookie work on `http://localhost` |
| `SMS_DRIVER` | `dev` or `provider`. The API refuses to start in production with `dev` |
| `PAYMENT_PROVIDER` | `manual` only (see below) |
| `STORAGE_DRIVER` | `local` (files under `STORAGE_LOCAL_DIR`) or `s3` (`S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT` for any S3-compatible store; uses the task role when no keys are given) |
| `PUBLIC_API_URL` | Empty = relative upload / file URLs (right for a web client on the same origin). Set it when native clients need absolute URLs |
| `TRUST_PROXY` | Number of reverse proxies in front of the API, so rate limits see the real client address |
| `ADMIN_MFA_ENFORCE_ALL` | Require TOTP for every staff role. `super_admin` always requires it |
| `JOBS_ENABLED` | Scheduled jobs (expiry sweeps, outbox poller). Jobs take a Redis lock, so several instances are safe |

Google Analytics / Google Ads / AdSense identifiers are **not** environment variables: a super administrator saves them through `PUT /admin/settings`, and clients read them from `GET /public/config`. An empty identifier means that integration is off.

## What is real and what is a stub

Built and exercised by the test suite: phone OTP sign-in, rotating refresh tokens with reuse detection, staff password + TOTP, role and permission guards, partner onboarding, document upload and verification, owner-driver authorisations, PostGIS driver search, ride requests, quotations, bookings and their state machine, reviews, in-app notifications, support tickets, plans and subscriptions, featured placements, sightseeing packages, local advertisements, platform settings, audit log, transactional outbox, idempotency keys.

Stubs — each one sits behind a port with a labelled placeholder adapter, and none pretends to work:

| Capability | State |
| --- | --- |
| **SMS** | `DevSmsSender` logs the code and echoes it as `devCode`. `ProviderSmsSender` throws "not implemented". A real adapter (DLT-registered sender and template in India) is needed before launch |
| **Payments** | `ManualPaymentGateway`: no money moves; checkout completes at once and the invoice is recorded as settled offline. `RazorpayGateway` is not implemented and the API refuses to start with `PAYMENT_PROVIDER=razorpay`. There is no webhook, refund or reconciliation flow yet |
| **Push notifications** | `LoggingPushSender` logs what would be sent. The in-app inbox is the working channel |
| **Email** | No sender. Optional email on an account is stored but not verified |
| **Routing / geocoding** | Fare estimates use straight-line distance × 1.3 and are labelled `straight_line`. Places are a curated list, not a geocoder |
| **Booking fee and late-cancellation fee** | Calculated and recorded on the booking; not collected (no customer payment integration) |

Known gaps: staff cannot change their own password or enrol MFA voluntarily (no route in the contract); the price of a paid featured day is an environment variable (`FEATURED_PRICE_PER_DAY_MINOR`), not an admin setting; the OpenAPI document lists request bodies and responses but not query-string parameters.

## Layout

```
src/
  common/        shared kernel: db access, redis, auth guards, audit, idempotency, outbox, errors
  config/        environment parsing
  database/      migrations (hand-written SQL), migration runner, demo seed
  modules/
    platform/    health, public config, settings, audit-log reader
    identity/    OTP, sessions, staff sign-in + MFA, the account's own data, staff management
    catalog/     regions, places, vehicle categories, fare estimate
    storage/     uploads behind a storage port (local disk / S3)
    marketplace/ partner profiles, vehicles, documents, authorisations, verification, discovery
    billing/     plans, subscriptions, invoices, featured placements, entitlements
    promotions/  sightseeing packages, advertisements
    bookings/    ride requests, quotations, bookings
    engagement/  reviews, notifications, support
    admin/       overview (composes the other modules' statistics)
  openapi/       OpenAPI export
test/            end-to-end suite and its harness
```

Each module has `domain/` (pure rules, unit-tested), `application/` (use cases), `infrastructure/` and `presentation/` (controllers and request validation). Modules call each other through exported services and react to each other's domain events delivered by the outbox.

Data access is SQL-first: `common/db/db.service.ts` runs parameterised SQL on the TypeORM `DataSource` (pool, transactions, migrations) rather than through entity classes. Transactions are ambient — `db.tx()` — so a use case spanning several services commits or rolls back as one.

## Container image

```bash
# from the repository root
docker build -f apps/api/Dockerfile -t payana-api .
docker run --rm --env-file apps/api/.env payana-api node dist/database/migrate.js up   # migrations
docker run --rm --env-file apps/api/.env -p 3000:3000 payana-api                        # API
```

The image is `linux/amd64`, runs as UID 1000, and trusts the Amazon RDS certificate bundle at `/etc/ssl/certs/rds-global-bundle.pem` (via `NODE_EXTRA_CA_CERTS`), so `DATABASE_SSL=true` verifies an RDS endpoint.
