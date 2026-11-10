# ADR-0002 — TypeORM, SQL migrations and PostGIS

*Status: accepted · 2026-11-10 · Source: brief §3 ("database migrations and transactional writes"), §4 ("PostGIS for geospatial queries")*

## Context

The system needs relational integrity, transactions that span several tables,
row locks for quote acceptance, and geospatial "within radius" queries. The
API is NestJS, whose first-party database integration is `@nestjs/typeorm`.
At initialisation the current stable TypeORM is the 1.x line; the legacy
0.3.x line is still published. `@nestjs/typeorm` 12 supports both.

## Decision

1. **PostgreSQL 17 with the PostGIS 3.5 extension** is the system of record.
   Positions are `geography(Point, 4326)`; proximity uses `ST_DWithin` with
   GiST indexes; distances are metres.
2. **TypeORM (latest stable 1.x, pinned)** maps module-private entities and
   provides the unit of work. If a blocking defect is found in 1.x the team
   may pin the legacy 0.3 line and must record that in a superseding ADR.
3. **Migrations are explicit, reviewed, forward-only** files run by tooling
   (`migration:run`) as a separate step before deployment. `synchronize` is
   never enabled outside throw-away tests.
4. **Geospatial and locking queries are written as SQL** behind repository
   ports (`findNearby`, `lockRequestForAccept`), not through ORM query
   magic, so their plans can be inspected and tested.
5. Repositories are **ports in the domain layer** with TypeORM adapters in
   infrastructure; use cases never import TypeORM.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Prisma | PostGIS types are `Unsupported`, forcing raw SQL for the core feature anyway; recent major versions changed client generation and driver setup; less natural with NestJS DI and explicit transactions |
| Kysely / plain `pg` | Excellent control and typing for SQL, but more hand-written CRUD for ~35 tables; kept as the fallback if the ORM gets in the way |
| MongoDB with geo indexes | Brief mandates PostgreSQL; weaker transactional guarantees for acceptance |
| Geohash columns without PostGIS | Brief mandates PostGIS; edge cases at cell borders; no real distance |

## Consequences

- **Good**: one database technology for relational and spatial needs; real
  migrations; inspectable SQL where it matters.
- **Cost**: two styles of data access (ORM for CRUD, SQL for spatial/locking)
  — acceptable and documented.
- **Risk**: TypeORM 1.x is newer than most available guidance; mitigated by
  pinning, type-checking, and integration tests against a real database
  (never mocks) for every repository.
- **Operational**: the RDS instance must allow `CREATE EXTENSION postgis`;
  the first migration creates it.
- **Testing**: integration tests need Docker (PostGIS image); there is no
  in-memory substitute and none is attempted.
