# Payana — hyperlocal mobility marketplace (Gokarna launch)

Verified local autos, taxis and tour drivers. Customers ask once, compare drivers' quotes and book;
drivers and owners list vehicles, get verified and quote; administrators verify, moderate and configure.
"Payana" (ಪಯಣ, *journey*) is a working name — see `specs/constitution.md`.

| Part | Where | Stack |
| --- | --- | --- |
| Specs (SDD) | `specs/` | constitution → requirements → 18 feature specs → architecture/ADRs → data model → threat model → test strategy → release plan → traceability |
| Shared API contract | `packages/contracts` | TypeScript types + route map used by API and web |
| API | `apps/api` | NestJS 12, PostgreSQL 17 + PostGIS, Redis, TypeORM migrations |
| Web (PWA) | `apps/web` | Angular 22, signals, standalone, lazy routes, service worker |
| Infrastructure | `infra/`, `.github/` | Terraform (AWS ap-south-1), GitHub Actions CI/deploy |

## Run it locally

Prerequisites: Node 24, Docker Desktop (running).

```bash
npm run setup          # install + build contracts, install api and web
npm run infra:up       # Postgres/PostGIS on :5439, Redis on :6380
npm run api:migrate    # create the schema
npm run api:seed       # reference + demo data (dev only)
npm run api:dev        # API on http://localhost:3000  (Swagger at /api/docs)
npm run web:dev        # web on http://localhost:4200  (proxies /api to :3000)
```

Ports 5439/6380 are deliberately non-default so they do not clash with other local databases.
Copy `apps/api/.env.example` to `apps/api/.env` first if it does not exist.

### Signing in (development)

- **Customer or driver:** any Indian mobile number. No SMS gateway is connected in development, so the
  one-time code is shown on the sign-in screen.
  Seeded drivers: `+919000000101`–`114` (approved), `115` (pending), `116` (changes requested).
  Seeded customers: `+919000000201`–`205`.
- **Staff:** `/admin/sign-in` — `super@`, `verify@`, `support@`, `finance@`, `marketing@payana.local`,
  password `Payana-Dev-Admin-2026!`, then a 6-digit code from an authenticator app using the dev secret
  `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` (or run `npm --prefix apps/api run totp`).
  These credentials exist only in seeded development data.

## Adding your Google Analytics / Google Ads accounts later

Nothing Google-related loads until you add an ID **and** a visitor accepts the privacy banner.

1. Sign in as `super@…` → **Admin → Settings → Analytics & Ads**.
2. Paste your **GA4 Measurement ID** (`G-…`), **Google Ads tag ID** (`AW-…`) and, per business event,
   the **conversion label** (the part after the `/` in Google's event snippet). Optional: AdSense
   publisher ID (`ca-pub-…`) and slot IDs.
3. Save. Each field has a "Where do I find this?" guide, and the status cards show what is live.

Alternative without the database: fill the same IDs in `apps/web/public/app-config.json` on the web server.
For AdSense, also add your line to `apps/web/public/ads.txt`.
Conversions sent: customer sign-up, ride requested, booking confirmed (with fare), driver sign-up, plan purchased.

## Quality checks

```bash
npm run api:test                       # API unit tests
npm --prefix apps/api run test:e2e     # API integration tests (needs infra:up)
npm run web:test                       # web unit tests
npm --prefix apps/web run lint
npm run web:build                      # production build
```

## Not production-ready yet (launch blockers)

These are stubbed by design and listed in `specs/deployment/release-plan.md`:

- **SMS**: development adapter only — a real gateway (with India DLT registration) is needed for OTP.
- **Payments**: "manual" adapter — plan purchases complete without charging. Razorpay adapter not implemented.
- **Push / e-mail notifications**: logged, not delivered. In-app notifications work.
- **Legal**: privacy notice and terms are drafts; legal entity, grievance officer and aggregator-licensing
  position need professional advice.
- **Maps**: no map provider yet; nearby drivers are shown as distance + direction (compass view).
- **Mobile apps**: the PWA installs on phones; native Android/iOS packaging (Capacitor) is planned, and a
  PWA cannot share a driver's location in the background.
