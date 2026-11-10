# Architecture Decision Records

One decision per file. Format: **Context → Decision → Alternatives →
Consequences**. Status is `accepted` unless stated. A superseded ADR is kept
and marked; it is never deleted or rewritten (NFR-MAINT-004).

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith with an extraction path | accepted |
| [0002](0002-typeorm-sql-migrations-postgis.md) | TypeORM + SQL migrations + PostGIS | accepted |
| [0003](0003-token-strategy.md) | In-memory access token + HttpOnly rotating refresh token | accepted |
| [0004](0004-admin-mfa-totp.md) | Administrator MFA with TOTP | accepted |
| [0005](0005-signals-and-services-not-ngrx.md) | Signals + small stores instead of NgRx | accepted |
| [0006](0006-no-ssr-at-launch.md) | No server-side rendering at launch | accepted |
| [0007](0007-pwa-first-capacitor-later.md) | PWA first; Capacitor later behind adapters | accepted |
| [0008](0008-custom-design-system.md) | Custom design system, no UI kit | accepted |
| [0009](0009-payment-port-manual-adapter.md) | Payment port with a manual adapter first | accepted |
| [0010](0010-sms-port-dev-adapter.md) | SMS port with a development adapter | accepted |
| [0011](0011-object-storage-port.md) | Object-storage port (local disk / S3) | accepted |
| [0012](0012-polling-before-realtime.md) | Polling before SSE / WebSocket | accepted |
| [0013](0013-redis-usage.md) | What Redis is and is not used for | accepted |
| [0014](0014-analytics-gtag-consent-mode.md) | Analytics via gtag, Consent Mode v2, run-time configuration | accepted |
| [0015](0015-map-provider-deferred.md) | Map provider deferred; curated places and a distance/bearing radar at launch | accepted |
| [0016](0016-repo-layout-and-contracts-package.md) | Repository layout without npm workspaces; shared contracts package | accepted |
| [0017](0017-money-as-minor-units.md) | Money as integer minor units | accepted |

To add one: copy the structure, take the next number, link it here and from
the spec that depends on it.
