# Source brief (as received)

> **Status of this file.** This is the product owner's brief exactly as it was
> supplied on 2026-11-10. It is the root input every other spec traces back to.
>
> **It is incomplete.** The text was cut off part-way through §6, Module 2
> ("Vehicle listings with searchab…"). Everything after that point — the rest
> of Module 2 and any further modules or sections — was never received.
> Requirements for those areas are *inferred* from §1 and §5 and are marked as
> assumptions in `specs/product-requirements.md`. When the remainder of the
> brief is available, append it here and re-run the traceability review.

---

## Supplementary direction from the product owner (2026-11-10)

Received together with the brief, and binding on the web client:

- Good layouts.
- Good colours — **no purple and no blue "AI-generated" palettes**.
- Animations, including scroll-driven animations.
- Vector graphics.
- Responsive design.
- Google Analytics and Google Ads settings prepared in advance; the owner will
  add the account identifiers later.

These are specified in `specs/features/F-13-design-system-and-motion.md` and
`specs/features/F-14-analytics-and-ads.md`.

---

## MASTER BUILD PROMPT: Production-Ready Hyperlocal Mobility & Travel Marketplace

### 1. Your Role

Act as a principal software architect, senior full-stack engineer, mobile architect, product manager, UX designer, DevOps engineer, security engineer, QA automation engineer, and technical writer.

Build a production-grade, scalable, secure, multi-role mobility marketplace combining:

1. OLX-style local driver and vehicle listings.
2. Rapido-style nearby auto and taxi discovery and ride requests.
3. Advance taxi reservations and outstation travel bookings.
4. Tourist transport and sightseeing packages.
5. Driver subscriptions, premium listings, local business advertisements, and configurable booking fees.

The initial launch market is Gokarna, Karnataka, India. The architecture must support expansion to Kumta, Honnavar, Murudeshwar, Karwar, and other regions without redesigning the application.

Do not generate a superficial UI prototype. Develop a complete, maintainable application with functional business workflows, persistent data, API validation, role-based access control, security controls, automated tests, deployment configuration, observability, and release documentation.

### 2. Mandatory Development Methodology: Spec-Driven Development

Follow Spec-Driven Development (SDD) throughout the project.

Do not start by generating the entire application from a single prompt or by creating UI screens without defined behavior.

Use this sequence:

Constitution → Product requirements → Feature specifications → Architecture → API contracts → Data model → Implementation plan → Code → Tests → Security review → Release.

Create and maintain these artifacts in the repository:

* specs/constitution.md
* specs/product-requirements.md
* specs/personas-and-journeys.md
* specs/functional-requirements.md
* specs/non-functional-requirements.md
* specs/features/
* specs/architecture/system-design.md
* specs/architecture/adr/
* specs/architecture/data-model.md
* specs/api/openapi.yaml
* specs/security/threat-model.md
* specs/testing/test-strategy.md
* specs/deployment/release-plan.md
* specs/traceability-matrix.md
* specs/implementation-plan.md

Each feature specification must include:

* Business objective and scope.
* User stories and acceptance criteria.
* Preconditions, postconditions, and business rules.
* Primary and alternative workflows.
* Loading, empty, error, retry, and offline states.
* API and database changes.
* Authorization and security requirements.
* Validation rules.
* Unit, integration, end-to-end, and negative test cases.
* Performance and accessibility requirements.
* Deployment, rollback, and observability considerations.

Use testable Given/When/Then acceptance criteria.

Maintain traceability from every requirement to its implementation, API, and automated tests.

If a requirement is ambiguous, document the assumption and its consequences. Ask questions only when the decision blocks implementation or creates significant business, security, or regulatory risk.

Do not silently remove features to simplify development.

### 3. Architecture Principles

Use a modular monolith for the initial production release, with clearly defined module boundaries and the ability to extract independently deployable services when actual scale requires it.

Avoid premature microservices.

Use:

* Clean Architecture and dependency inversion.
* Domain-driven module boundaries where appropriate.
* SOLID principles.
* Explicit DTOs and runtime validation.
* REST APIs with OpenAPI documentation.
* Database migrations and transactional writes.
* Idempotent operations for critical booking and payment workflows.
* Event-driven processing for notifications and asynchronous work.
* Centralized authorization, validation, error handling, and audit logging.
* Versioned API contracts.
* Environment-based configuration and secret management.

Architecture must be documented using system context, container, component, deployment, and key sequence diagrams. Use Mermaid diagrams where useful.

### 4. Technology Stack

#### Frontend

* Angular, using the latest stable version compatible with the selected ecosystem at project initialization.
* TypeScript with strict compiler settings.
* Angular standalone components and lazy-loaded feature routes.
* Angular Router and functional route guards.
* Reactive Forms with reusable validation.
* A consistent, accessible design system.
* RxJS for asynchronous streams where appropriate.
* Signals for local and derived UI state where appropriate.
* Progressive Web App capabilities.
* Responsive layouts for mobile, tablet, and desktop.
* Server-side rendering only where justified by SEO or initial-render requirements.

Choose a maintainable state-management approach. Do not introduce NgRx or another large state library without a documented reason.

#### Mobile strategy

Design the application so that Android and iOS can be added without rewriting the domain logic.

Use:

* Angular shared UI and business logic where appropriate.
* Ionic with Capacitor for mobile packaging and native capabilities when justified.
* A shared API client and typed API contracts.
* Native plugins behind platform-specific adapters.
* Push notifications, deep links, secure token storage, camera access, and location permissions through suitable native integrations.
* Platform-specific handling for background location, permissions, and network failures.

Keep browser-only and native-only APIs out of shared domain code.

A PWA must not be represented as equivalent to a fully native application, especially for background location and push-notification behavior.

#### Backend

* Node.js LTS supported at project initialization.
* TypeScript in strict mode.
* NestJS with modular architecture.
* REST APIs under /api/v1.
* OpenAPI/Swagger documentation.
* Runtime request validation.
* Authentication and authorization guards.
* Centralized exception handling.
* Structured logging.
* Background jobs and scheduled tasks.
* Integration and contract tests.

#### Database and infrastructure

* PostgreSQL as the primary transactional database.
* PostGIS for geospatial queries and nearby-driver discovery.
* Redis for caching, rate limiting, temporary availability state, and job coordination when required.
* S3-compatible object storage for vehicle photos, documents, and other uploaded files.
* A managed queue or job-processing mechanism for notifications and asynchronous workflows.
* Docker and Docker Compose for local development.
* AWS-compatible deployment architecture, including managed PostgreSQL, object storage, secrets, logs, metrics, and suitable compute.
* Infrastructure as Code using Terraform or an equivalent tool.
* CI/CD pipelines with quality gates.

Use supported stable versions and pin dependencies. Record major technology choices in architecture decision records.

### 5. User Roles and Authorization

Implement three primary account roles with granular permissions.

#### A. End User / Customer

Capabilities:

* Register and sign in using phone OTP, with suitable rate limits and account recovery.
* Manage profile, preferences, saved places, and emergency contact information.
* Discover nearby autos, taxis, SUVs, and other configured vehicle categories.
* Search by location, radius, pickup, destination, date, time, vehicle type, capacity, and trip type.
* View driver profiles, verified status, vehicle details, indicative rates, ratings, and service areas.
* Request an immediate ride.
* Request advance bookings.
* Receive multiple driver quotations where appropriate.
* Compare quotations and select a driver.
* View booking details, status, cancellation policy, and contact options.
* Receive booking notifications.
* View booking history and receipts.
* Submit reviews and report issues after eligible bookings.
* Manage consent, privacy preferences, and account deletion requests.
* Access help, complaints, refunds, and support workflows.

#### B. Driver / Vehicle Owner

Support individual drivers, fleet owners, and authorized driver-owner relationships.

Capabilities:

* Register and submit identity, driving licence, vehicle registration, insurance, permit, fitness, and other applicable documents.
* Maintain vehicle profiles, photos, vehicle categories, seating capacity, luggage capacity, and service areas.
* Configure service availability and operating hours.
* Set indicative rates and trip pricing within platform rules.
* Receive and respond to ride requests and advance booking enquiries.
* Submit quotations with fare, inclusions, exclusions, pickup details, and validity.
* Accept or decline requests.
* Manage bookings and permitted status transitions.
* Update availability without claiming a confirmed location when location is stale.
* Contact customers through authorized channels.
* View earnings or booking records where applicable.
* Subscribe to paid plans.
* Purchase featured listing placements.
* View subscription status, invoices, renewals, and expiry.
* View performance metrics, enquiry counts, ratings, and cancellation rates.
* Manage fleet vehicles and assign authorized drivers when applicable.
* Respond to customer reviews and support complaints.

Distinguish the registered vehicle owner from the person driving the vehicle. Validate their relationship and permissions before allowing a driver to operate a vehicle in the marketplace.

#### C. Platform Administrator

Implement a secure administrative dashboard with granular permissions for:

* User and account management.
* Driver, owner, and vehicle verification.
* Document review, rejection reasons, expiry tracking, and re-verification.
* Listing approval, suspension, and removal.
* Booking monitoring and dispute resolution.
* Cancellation and refund workflows.
* Subscription plans, entitlements, renewals, and payment reconciliation.
* Advertisement inventory, campaigns, placement, and reporting.
* Service-area and location management.
* Vehicle categories and configurable pricing rules.
* Support tickets, abuse reports, ratings moderation, and fraud investigation.
* Notification templates and delivery status.
* Coupons or promotional campaigns where enabled.
* Financial and operational reporting.
* Audit logs and security-event review.
* Feature flags, application configuration, and operational health.

Implement a separate privileged administrator role within the administrative role hierarchy. Do not grant every administrator unrestricted access.

Require stronger authentication for privileged users, and use MFA where supported.

Never rely on frontend route guards alone for authorization.

Enforce server-side role and resource-level permissions on every protected operation.

### 6. Functional Modules

Implement the following modules with explicit specifications.

#### Module 1: Identity and Access

* Phone OTP authentication.
* Optional email authentication and account linking.
* Session and refresh-token management.
* Logout and token revocation.
* Device/session management where appropriate.
* Account lockout and abuse prevention.
* Role assignment and authorization.
* Consent and privacy preferences.
* Account suspension and recovery.
* Secure account deletion workflows.

#### Module 2: Driver and Vehicle Marketplace

* Driver and owner profiles.
* Vehicle listings with searchab

*— brief truncated here; remainder not received —*
