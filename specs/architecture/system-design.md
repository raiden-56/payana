# Payana — System Design

*Version 1.0 · 2026-11-10 · decisions are recorded in `adr/`*

This document describes the target architecture of Release 1. Where the code
and this document disagree after implementation, the difference is a defect
in one of them and is resolved explicitly — not left standing.

## 1. Architectural drivers

| Driver | Consequence |
| --- | --- |
| Small team, one launch town, unknown demand | Modular monolith; managed services; no premature distribution (ADR-0001) |
| Expansion to more towns by configuration | Region, category, place, plan and fee are data (F-03) |
| Trust and privacy are the product | Server-side authorisation everywhere; location and phone disclosure rules in one place; consent-gated tags |
| Patchy mobile networks | PWA shell, small bundles, idempotent writes, polling tolerant of loss |
| Web now, native later | Typed shared contracts; platform adapters; token transport that works for both |
| External vendors undecided (SMS, payments, maps) | Ports with development adapters; vendors are swappable |

## 2. System context

```mermaid
flowchart TB
    customer([Customer<br/>visitor or resident])
    partner([Partner<br/>driver, owner, fleet owner])
    staff([Administrator<br/>five admin roles])
    advertiser([Local advertiser<br/>offline relationship])

    subgraph payana [Payana]
        web[Web client PWA]
        api[Payana API]
    end

    sms[[SMS gateway<br/>DLT-registered · R1.1]]
    pay[[Payment gateway<br/>R1.1]]
    google[[Google tag, Analytics, Ads, AdSense<br/>only when configured and consented]]
    push[[FCM / APNs<br/>R2]]
    maps[[Map and routing provider<br/>undecided]]

    customer --> web
    partner --> web
    staff --> web
    advertiser -. campaign brief .-> staff
    web --> api
    api --> sms
    api --> pay
    api -.-> push
    api -.-> maps
    web -. after consent .-> google
```

Solid lines exist in R1 (SMS and payments through development adapters).
Dashed lines are later releases or conditional.

## 3. Containers

```mermaid
flowchart LR
    subgraph client [Client devices]
        pwa[Angular 22 PWA<br/>service worker, in-memory access token]
        native[Capacitor shell<br/>Android / iOS · R2]
    end

    subgraph edge [Edge]
        cdn[CloudFront + S3<br/>static web assets]
        alb[Application Load Balancer<br/>TLS, health checks]
    end

    subgraph app [Application · ECS Fargate]
        api1[API task 1<br/>NestJS 12]
        api2[API task N<br/>NestJS 12]
    end

    subgraph data [Data · private subnets]
        pg[(PostgreSQL 17 + PostGIS<br/>RDS Multi-AZ)]
        redis[(Redis<br/>ElastiCache)]
        s3[(S3 private bucket<br/>documents, photos)]
    end

    secrets[[Secrets Manager]]
    logs[[CloudWatch logs, metrics, alarms]]

    pwa --> cdn
    pwa --> alb
    native -.-> alb
    alb --> api1
    alb --> api2
    api1 --> pg
    api2 --> pg
    api1 --> redis
    api2 --> redis
    api1 --> s3
    pwa -. presigned PUT / GET .-> s3
    api1 --> secrets
    api1 --> logs
    api2 --> logs
```

| Container | Technology | Responsibility | State |
| --- | --- | --- | --- |
| Web client | Angular 22, standalone components, signals, service worker | All three audiences' UI; lazy areas `home, explore, auth, booking, account, packages, partner, admin, legal` | Access token in memory; consent choice and drafts on device; catalogue in SW cache |
| API | NestJS 12 on Node 24, REST under `/api/v1` | All business rules, authorisation, jobs, outbox worker | Stateless |
| PostgreSQL + PostGIS | RDS | System of record; geospatial queries | Durable |
| Redis | ElastiCache | Rate limits, lockouts, job locks, short caches, in-flight idempotency markers, session-revocation cache | Ephemeral; rebuildable |
| Object storage | S3 (local disk in development) | Documents, vehicle and profile photos | Durable, private |
| Shared contracts | `packages/contracts` (TypeScript) | Types, enums, constants, route map compiled into web and API | Build-time |

## 4. API components (modular monolith)

```mermaid
flowchart TB
    subgraph presentation [HTTP edge]
        pipeline[Request pipeline<br/>request ID · rate limit · auth · permission · idempotency · validation · problem details]
    end

    subgraph modules [Business modules]
        identity[identity<br/>OTP, sessions, admin login + MFA, me, consents, deletion]
        catalog[catalog<br/>regions, categories, places, fare estimate]
        marketplace[marketplace<br/>partner profiles, vehicles, documents, authorisations, availability, location, search, verification rules]
        bookings[bookings<br/>ride requests, quotes, bookings, transitions, receipts]
        commerce[commerce<br/>plans, subscriptions, invoices, featured, packages, ad campaigns]
        engagement[engagement<br/>reviews, support tickets, notifications]
        admin[admin<br/>overview, users, staff, admin presentation of other modules]
    end

    subgraph platform [platform]
        settings[settings + public config]
        audit[audit log]
        outbox[outbox + worker]
        jobs[scheduler + locks]
        idem[idempotency store]
        storage[storage port<br/>local · S3]
        smsport[SMS port<br/>dev · gateway]
        payport[payment port<br/>manual · gateway]
        health[health]
    end

    pipeline --> identity
    pipeline --> catalog
    pipeline --> marketplace
    pipeline --> bookings
    pipeline --> commerce
    pipeline --> engagement
    pipeline --> admin

    bookings -->|eligibility, vehicle policy| marketplace
    bookings -->|category, region, estimate| catalog
    bookings -->|entitlements, fee settings| commerce
    marketplace -->|category, region| catalog
    marketplace -->|entitlements| commerce
    commerce -->|vehicle ownership| marketplace
    engagement -->|booking facts, dispute trigger| bookings
    admin --> identity
    admin --> marketplace
    admin --> bookings
    admin --> commerce
    admin --> engagement

    identity --> smsport
    commerce --> payport
    marketplace --> storage
    modules --> audit
    modules --> outbox
    outbox --> engagement
    modules --> settings
```

### 4.1 Layers inside a module

```
modules/<name>/
  domain/          entities, value objects, policies, domain events, repository + gateway ports
  application/     use cases (one class per operation), transactions, authorisation checks on resources
  infrastructure/  TypeORM entities + repositories, Redis, adapters implementing ports
  presentation/    controllers, request DTOs with validation, response mappers
  <name>.module.ts exports ONLY its public application services
```

Dependencies point inward: `presentation → application → domain ←
infrastructure`. Frameworks appear only in `presentation` and
`infrastructure`.

### 4.2 Module boundary rules

| Rule | Enforcement |
| --- | --- |
| A module never reads or joins another module's tables | Import-boundary lint; repository classes are not exported |
| Cross-module calls use exported application services (synchronous, in-process) | Module `exports` |
| Cross-module reactions use domain events through the outbox (asynchronous) | Outbox handlers |
| Shared kernel is limited to `packages/contracts` types and `platform` services | Review |
| Foreign keys across module boundaries are allowed for integrity but are never navigated in code | Review |

Policies that several modules need live where the data lives and are exported
as services: *listed driver* and *may operate vehicle* (marketplace),
*entitlements* (commerce), *region of a point* (catalog).

### 4.3 Dependency note

`marketplace ⇄ commerce` is a cycle at module level (entitlements ↔ vehicle
ownership). It is broken by ports: commerce defines a `VehicleOwnershipPort`
that marketplace implements, and marketplace depends on commerce's
`EntitlementService`. No cyclic provider injection is permitted.

## 5. Deployment

```mermaid
flowchart TB
    user([Browser / PWA])
    dns[Route 53]

    subgraph aws [AWS ap-south-1]
        cf[CloudFront<br/>response headers: CSP, HSTS]
        webbucket[(S3 web bucket<br/>hashed assets)]
        acm[ACM certificates]

        subgraph vpc [VPC · 2 availability zones]
            subgraph public [Public subnets]
                alb[ALB :443]
                nat[NAT gateway]
            end
            subgraph private [Private subnets]
                ecs[ECS Fargate service<br/>API tasks ≥ 2, autoscaled]
                migrate[One-off ECS task<br/>migrations]
                rds[(RDS PostgreSQL 17<br/>Multi-AZ, PITR)]
                cache[(ElastiCache Redis)]
            end
        end

        files[(S3 private files bucket)]
        ecr[ECR]
        sm[Secrets Manager]
        cw[CloudWatch]
    end

    gh[GitHub Actions<br/>OIDC role]

    user --> dns
    dns --> cf
    dns --> alb
    cf --> webbucket
    alb --> ecs
    ecs --> rds
    ecs --> cache
    ecs --> files
    ecs --> sm
    ecs --> cw
    migrate --> rds
    ecs --> nat
    gh --> ecr
    gh --> webbucket
    gh --> ecs
    ecr --> ecs
```

- Web and API are served from sibling hostnames of one registrable domain
  (for example `app.` and `api.`) so the refresh cookie is first-party and
  `SameSite=Strict` works; alternatively CloudFront routes `/api/*` to the
  ALB so both share an origin. The second option is preferred because it
  removes CORS entirely; either is supported by configuration.
- Environments: `staging` and `production`, identical modules, separate
  accounts or at least separate VPCs and state.
- Local development: Docker Compose (PostgreSQL + PostGIS on host port 5439,
  Redis on 6380, optional MinIO), API and web run on the host; the Angular
  dev server proxies `/api` to the API so cookies are same-origin.

## 6. Key sequences

### 6.1 OTP sign-in with refresh rotation

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as Web client
    participant A as API (identity)
    participant R as Redis
    participant D as PostgreSQL
    participant S as SMS port

    U->>W: enters phone
    W->>A: POST /auth/otp/request {phone, intent}
    A->>R: check per-phone and per-IP limits, cooldown
    alt limit exceeded
        A-->>W: 429 rate_limited (retryAfterSeconds)
    else allowed
        A->>D: insert otp_challenge (code hash, expiry)
        A->>S: send code
        A-->>W: 200 OtpChallenge
    end
    U->>W: enters code
    W->>A: POST /auth/otp/verify {challengeId, code, deviceLabel}
    A->>D: load challenge, compare hash, count attempt
    alt wrong / expired / exhausted
        A-->>W: 400 otp_invalid | otp_expired | 429 otp_attempts_exceeded
    else correct
        A->>D: upsert user (roles by intent), insert session + refresh token (hashed)
        A-->>W: 200 AuthSession + Set-Cookie refresh (HttpOnly, Secure, SameSite=Strict)
    end
    Note over W: access token kept in memory only

    W->>A: POST /auth/refresh (cookie)
    A->>D: find token by hash
    alt token already used (reuse)
        A->>D: revoke session
        A->>R: mark session revoked
        A-->>W: 401 unauthenticated
    else valid
        A->>D: mark used, insert new token, touch session
        A-->>W: 200 AuthSession + new cookie
    end
```

### 6.2 Nearby search

```mermaid
sequenceDiagram
    autonumber
    participant W as Web client
    participant A as API (marketplace)
    participant C as catalog service
    participant D as PostgreSQL + PostGIS

    W->>A: GET /drivers?lat&lng&radiusKm&categoryCode&sort
    A->>A: validate, rate-limit (per IP)
    A->>C: region of point
    C-->>A: region or none
    alt outside every live region
        A-->>W: 200 empty page
    else in a live region
        A->>D: ST_DWithin on driver_locations (GiST), join listed drivers, filters
        D-->>A: candidates with distance, azimuth, recorded_at
        A->>A: freshness from age, snap to grid, round distance 0.1 km and bearing 10 deg, order
        A-->>W: 200 Paginated DriverListing (no coordinates)
    end
    Note over A: the search point is not stored and not logged
```

### 6.3 Request → quote → accept (transactional lock + idempotency)

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    actor Dr as Driver
    participant A as API (bookings)
    participant I as Idempotency store
    participant D as PostgreSQL
    participant O as Outbox worker

    C->>A: POST /ride-requests (Idempotency-Key k1)
    A->>I: begin(k1, body hash)
    alt key seen with same body
        I-->>A: stored response
        A-->>C: same RideRequest
    else new key
        A->>D: BEGIN, insert ride_request, select eligible drivers, insert outbox event, COMMIT
        A->>I: store response
        A-->>C: 201 RideRequest (open)
    end
    O->>D: claim outbox event, create notifications for eligible drivers

    Dr->>A: POST /driver/requests/{id}/quotes (Idempotency-Key k2)
    A->>D: BEGIN, re-check eligibility + vehicle policy + plan limit, insert quote (unique active per driver), outbox, COMMIT
    A-->>Dr: 201 Quote (active)

    C->>A: POST /ride-requests/{id}/quotes/{q}/accept (Idempotency-Key k3)
    A->>I: begin(k3)
    A->>D: BEGIN
    A->>D: SELECT ride_request FOR UPDATE
    alt request not open
        A->>D: ROLLBACK
        A-->>C: 409 request_not_open
    else open
        A->>D: load quote, re-validate active + driver still listed
        alt quote not active
            A->>D: ROLLBACK
            A-->>C: 409 quote_not_active
        else valid
            A->>D: insert booking (code, fare, frozen policy), booking_event confirmed
            A->>D: quote accepted, other active quotes closed, request booked
            A->>D: insert outbox quote.accepted, audit, COMMIT
            A->>I: store response
            A-->>C: 201 Booking (confirmed)
        end
    end
    O->>D: notify winning driver and the others
```

A concurrent second accept blocks on the row lock, then sees `booked` and
returns `409 request_not_open`. A network retry with the same key returns the
stored booking.

### 6.4 Document verification

```mermaid
sequenceDiagram
    autonumber
    actor P as Partner
    actor V as Verification officer
    participant A as API
    participant S as Object storage
    participant D as PostgreSQL

    P->>A: POST /uploads/presign {purpose, contentType, sizeBytes}
    A-->>P: uploadUrl, fileKey, headers, expiresAt
    P->>S: PUT bytes
    P->>A: POST /driver/documents {type, fileKey, documentNumber, expiresOn}
    A->>S: verify object exists, size, magic bytes
    A->>D: insert driver_document (pending), audit
    P->>A: POST /driver/profile/submit
    A->>D: checklist complete, status pending, outbox

    V->>A: GET /admin/verifications/{id} (perm verification.read)
    A->>S: sign GET URLs (max 5 min)
    A->>D: audit verification.case_viewed
    A-->>V: VerificationCase
    V->>A: POST /admin/documents/{docId}/review {decision, reason}
    A->>D: update document, audit, outbox document.reviewed
    V->>A: POST /admin/verifications/{id}/decision {approve}
    A->>D: BEGIN, check all required documents approved and unexpired
    A->>D: profile approved, qualifying vehicles approved + published
    A->>D: audit, outbox verification.decided, COMMIT
    A-->>V: VerificationCase
    Note over A,D: from now on the partner passes the listed gate used by search, fan-out and quoting
```

### 6.5 Analytics consent loading

```mermaid
sequenceDiagram
    autonumber
    actor U as Visitor
    participant W as Web client
    participant A as API
    participant G as Google origins

    W->>A: GET /public/config
    alt API unreachable
        W->>W: read static fallback file
    else ok
        A-->>W: PublicConfig.analytics
    end
    W->>W: merge sources, read stored consent
    alt every identifier empty
        Note over W: integration off, no banner, no globals, no requests
    else configured, consent required and undecided
        W-->>U: consent banner (Accept all / Reject all / Choose)
        alt Reject all
            W->>W: store decision
            Note over W,G: nothing is ever requested
        else grants analytics and/or advertising
            W->>W: gtag consent default (all denied)
            W->>W: gtag consent update (granted categories)
            W->>G: GET gtag.js (once)
            W->>G: config GA4 if analytics granted, config Ads if advertising granted
            W->>G: page_view with route-template path
        end
    else consent already decided
        W->>W: apply stored decision as above without banner
    end
    opt signed in
        W->>A: PUT /me/consents (keep server and device in step)
    end
```

## 7. Events and the outbox

- **Why**: notifications, counters and other reactions must not make a
  booking fail, and must not be lost if the process dies after commit.
- **Mechanism**: the use case inserts an `outbox_events` row in the same
  transaction as its state change. A worker in each API task claims rows
  with `FOR UPDATE SKIP LOCKED`, dispatches to in-process handlers, marks
  them processed, retries failures with back-off and parks poison events
  (NFR-REL-005).
- **Guarantee**: at-least-once, per-aggregate ordering by `occurred_at`;
  handlers are idempotent on `(event_id, handler)`.
- **Event catalogue** (type · aggregate): `ride_request.created|expired|cancelled`,
  `quote.submitted|withdrawn|accepted`, `booking.transitioned|cancelled|dispute_opened|dispute_resolved`,
  `document.reviewed|expiring|expired`, `verification.decided`,
  `authorization.created|accepted|revoked`, `subscription.changed`,
  `review.submitted`, `ticket.updated|message_added`, `account.suspended|deletion_scheduled|erased`.
- **Evolution**: when a module is extracted, its handlers move behind
  SNS/SQS; the outbox table becomes the relay source. Producers do not change.

## 8. Caching

| What | Where | TTL | Invalidation |
| --- | --- | --- | --- |
| Catalogue (regions, categories, places), public config | Redis + HTTP `ETag`/`Cache-Control`; service worker | 60 s server; SW per F-17 | On admin write |
| Entitlements per partner | Redis | 60 s | On subscription change |
| Eligible ad campaigns per placement + region | Redis | 60 s | On campaign write |
| Session-revocation flags | Redis | ≤ access-token lifetime | On logout / reuse / suspension |
| Admin overview | Redis | 60 s | Time only |
| Search results | Not cached (position- and time-dependent) | — | — |
| Authenticated responses | Never cached by intermediaries (`no-store`) | — | — |

Redis is never the only copy of anything that matters (ADR-0013).

## 9. Cross-cutting design

| Concern | Design |
| --- | --- |
| Authentication | ADR-0003: short JWT access token in memory + rotating opaque refresh token (HttpOnly cookie on web, secure store on native) |
| Authorisation | Declarative metadata on every handler (`public` / `user` / role / permission), enforced by a global guard; resource ownership checked in use cases; default deny |
| Validation | DTO classes with a global allow-list validation pipe; shared constants from `@payana/contracts` |
| Errors | One exception filter → `ProblemDetails` with `ErrorCode` |
| Idempotency | Interceptor on `(idem)` routes backed by `idempotency_keys` + Redis in-flight marker |
| Transactions | Unit of work opened by the use case; repositories take the transactional manager |
| Audit | `AuditService.record()` inside the transaction; append-only table |
| Configuration | Validated schema at start-up; secrets by reference |
| Time | UTC in storage and on the wire; `Asia/Kolkata` for business-day rules and display |
| Money | Integer minor units + currency (ADR-0017) |
| Geospatial | `geography(Point, 4326)` columns, GiST indexes, metres for distances |
| Realtime | Polling with `ETag` (ADR-0012) |
| Observability | JSON logs with request ID; RED metrics per route template; OpenTelemetry spans (P1) |

## 10. Web client architecture

```
apps/web/src/app/
  core/
    api/        typed API client built on ApiRoutes; interceptors (auth, idempotency, problem details)
    auth/       session store (signals), guards, refresh single-flight
    config/     PublicConfig loader + static fallback
    analytics/  AnalyticsPort, gtag adapter, consent store
    platform/   Geolocation, Storage, Network, Share, Camera, Push ports + web adapters
  ui/           design-system components, illustrations, motion directives (no feature knowledge)
  features/
    home/ explore/ auth/ booking/ account/ packages/ partner/ admin/ legal/
                each lazy-loaded: routes, pages, a small signal store, feature services
  styles/       tokens, base, utilities
```

- **State**: signals for local and derived state; one small injectable store
  per feature for server state and polling; RxJS at the HTTP/stream edges.
  No global store library (ADR-0005).
- **Routing**: lazy feature routes; functional guards for sign-in, role and
  permission (courtesy only — the API enforces).
- **Rendering**: client-side; no SSR at launch (ADR-0006).
- **Dependency rule**: `features → core, ui`; `ui → nothing app-specific`;
  `core → @payana/contracts`. Features do not import each other.

## 11. Extraction path to services

The monolith is split only when a measured need appears. The order below
follows coupling, not ambition.

| Step | Candidate | Trigger | What changes |
| --- | --- | --- | --- |
| 1 | **Worker process** (outbox handlers + scheduled jobs) | Jobs or fan-out compete with request latency | Same codebase, second ECS service with HTTP disabled; no contract change |
| 2 | **Notifications** (engagement handlers + channel adapters) | Push/SMS volume, provider rate limits | Outbox relay publishes to SNS/SQS; handlers consume there |
| 3 | **Discovery read model** | Search load dominates the primary database | Read replica or dedicated PostGIS store fed by events; `marketplace` search port gets a new adapter |
| 4 | **Commerce / payments** | Gateway webhooks, reconciliation, compliance isolation | Module becomes a service behind its existing service interface |
| 5 | **Identity** | Multiple client products or SSO | Token issuance separated; guards verify JWTs as today |

What makes each step cheap is already required in R1: no cross-module table
access, calls through exported interfaces, events through the outbox, and
contracts shared as a package.

## 12. Risks and open design questions

| # | Item | Mitigation / owner |
| --- | --- | --- |
| R-1 | Driver positions go stale because a PWA cannot report in the background | Freshness model; honest UI; native app in R2 (ADR-0007) |
| R-2 | Polling load grows with open requests | `ETag`/304, visibility-aware intervals, back-off; SSE in R2 (ADR-0012) |
| R-3 | Straight-line estimates mislead on ghat and estuary roads | Wide, labelled ranges; routing provider decision D-05 |
| R-4 | In-process jobs on N tasks | Distributed locks now; worker extraction step 1 |
| R-5 | Marketplace ⇄ commerce coupling | Ports as in §4.3; revisit at extraction step 4 |
| R-6 | Versions newer than the team's prior experience (NestJS 12, TypeORM 1.x, Angular 22, TypeScript 6) | Pin exact versions; rely on type-checking and integration tests; record deviations in ADRs |
