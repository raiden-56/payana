# ADR-0016 — Repository layout without npm workspaces; shared contracts package

*Status: accepted · 2026-11-10 · Source: brief §4 Mobile ("a shared API client and typed API contracts"), §3 ("explicit DTOs", "versioned API contracts")*

## Context

Web, API and future mobile clients must agree on every route, payload, enum
and constant. The repository holds an Angular application and a NestJS
application whose toolchains pin different dependency ranges and are happiest
with their own `node_modules`. Several people (and automation) install and
build in parallel.

## Decision

1. **One repository, three independent packages**, each with its own
   `package.json`, lockfile and `node_modules`:

   ```
   packages/contracts   @payana/contracts — types, enums, constants, ApiRoutes
   apps/api             NestJS API
   apps/web             Angular web client
   specs/  infra/  .github/  docker-compose.yml
   ```

   The root `package.json` contains only orchestration scripts that delegate
   with `npm --prefix`. **No npm workspaces, no hoisting.**
2. **`@payana/contracts` is the single source of truth for the API surface.**
   It has no runtime dependencies and contains only types, `as const`
   enumerations, constants (limits, regexes, TTLs) and the `ApiRoutes` path
   map. It is built to **both CommonJS and ES modules** with type
   declarations and consumed by `apps/api` and `apps/web` as a
   `file:../../packages/contracts` dependency.
3. **Contract-first flow**: a change to the API starts in
   `packages/contracts`, then the feature spec, then code on both sides.
   Controllers and the web API client build paths from `ApiRoutes`, so a
   route cannot drift. `specs/api/openapi.yaml` is exported from the running
   API and checked in CI (see `specs/api/README.md`).
4. **Versioning**: the URL prefix `API_PREFIX` (`/api/v1`) is the public
   version. Within v1 changes are additive; a breaking change means `/api/v2`
   alongside v1 for a deprecation period. The package version tracks the
   contract and is bumped on every change.
5. Build order is explicit: contracts → api / web (`npm run setup`, CI job
   dependencies).

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| npm / pnpm workspaces with hoisting | Shared `node_modules` invites version conflicts between the Angular and Nest toolchains and makes concurrent installs unsafe; little benefit for three packages |
| Nx / Turborepo monorepo tooling | Valuable at larger scale; adds concepts and configuration not yet needed |
| TypeScript path aliases to contract source | Breaks the Nest build output layout and run-time resolution; fine for Angular only |
| Generate clients from OpenAPI | A good later option for native or third-party clients; for TypeScript clients, sharing the source types is simpler and stricter |
| Duplicate DTOs on each side | Guaranteed drift |
| Separate repositories | Atomic contract + API + web changes become multi-repo choreography |

## Consequences

- **Good**: independent installs and upgrades; one place to read the API;
  compile-time agreement between web and API; a mobile client can depend on
  the same package.
- **Cost**: contracts must be rebuilt after a change before dependants see
  it (`npm run contracts:build`); CI caches three `node_modules`.
- **Rule**: contracts never import framework code and never contain
  behaviour beyond pure constants and path builders.
- **Trigger to revisit**: a fourth or fifth package, or build times that
  justify task caching — then adopt workspaces with a tool that isolates
  dependencies.
