## What and why

<!-- One or two sentences: what changes for a customer, driver or administrator, and why. -->

**Requirement / feature spec:** <!-- e.g. FR-BOOK-04, specs/features/F-07-ride-requests-and-quotations.md -->

## How it was verified

<!-- Commands run, tests added, screens checked. "CI is green" alone is not verification. -->

## Definition of done

From `specs/constitution.md` §5. Tick each item, or strike it through with a
reason if it truly does not apply to this change.

- [ ] The feature spec exists and its Given/When/Then acceptance criteria are met.
- [ ] Unit tests cover the rules, integration tests cover the API and database behaviour, and negative tests cover authorisation and validation failures.
- [ ] Lint, type-check, tests and build pass in CI.
- [ ] Any new screen has loading, empty, error, retry and offline states.
- [ ] Inputs are validated at the API boundary, and every new endpoint declares its required permission.
- [ ] Security-relevant actions write an audit log entry.
- [ ] `specs/traceability-matrix.md` is updated, and `specs/api/openapi.yaml` too where API behaviour changed.
- [ ] Migrations run forward on an empty database and on the previous release.

## Risk and rollback

- **Migration in this change:** <!-- none / additive / needs a note: old code must keep working against the new schema -->
- **Feature flag:** <!-- flag name, or "not needed because ..." -->
- **How to roll back:** <!-- usually: redeploy the previous commit with the Deploy workflow -->

## Status of what this adds

<!-- built / partial / stubbed / planned - say so here and in the spec. Nothing is described as production-ready that has not passed its acceptance tests. -->
