# Infrastructure

Where Payana runs, from a laptop to production.

| Where | What | Defined in |
| --- | --- | --- |
| Your machine | PostgreSQL + PostGIS, Redis, optional S3-compatible storage | [`docker-compose.yml`](../docker-compose.yml) at the repository root |
| CI | The same PostgreSQL and Redis images as service containers | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| Staging, production | AWS: CloudFront, S3, load balancer, ECS Fargate, RDS, ElastiCache | [`terraform/`](terraform/README.md) |
| Releases | Manual, OIDC-authenticated deploy and rollback | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) |

## Local development

```sh
npm run infra:up      # docker compose up -d --wait postgres redis
npm run infra:down    # stop; data is kept in the pgdata volume
docker compose down -v   # stop and delete the local database
```

| Service | Image | Host port | Override with |
| --- | --- | --- | --- |
| PostgreSQL 17 + PostGIS 3.5 | `postgis/postgis:17-3.5` | **5433** | `PG_HOST_PORT` |
| Redis 7.4 | `redis:7.4-alpine` | **6380** | `REDIS_HOST_PORT` |
| MinIO (optional, profile `s3`) | `minio/minio` | 9100, console 9101 | `MINIO_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT` |

**Why not 5432 and 6379?** Developer machines very often already have a
PostgreSQL or Redis listening on the default ports — a system service, or
another project's containers. Binding one port up avoids a start-up failure
that looks like a Payana bug and is not.

If 5433 or 6380 is taken too, pick any free port and keep the API in step:

```sh
PG_HOST_PORT=5439 npm run infra:up
# then, in apps/api/.env:
# DATABASE_URL=postgres://payana:payana_dev_only@localhost:5439/payana
```

The credentials in `docker-compose.yml` (`payana` / `payana_dev_only`) are for
local use only and are not secrets. The database is empty until you run the
API's migrations (`npm run api:migrate`) and, for demo data, `npm run api:seed`.

MinIO is only needed to exercise the S3 storage adapter locally; by default
the API stores uploads on disk. Start it with
`docker compose --profile s3 up -d` and set `STORAGE_DRIVER=s3` plus the
`S3_*` variables in `apps/api/.env`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`: contracts build, API lint / type-check / build / unit and integration
tests against real PostGIS and Redis, an OpenAPI drift check, web lint / unit
tests / production build, dependency audit, secret scan, and Terraform
format / validate / offline plan. End-to-end browser tests run on `main`.

`.github/dependabot.yml` keeps npm packages, the API base image, GitHub
Actions and Terraform providers current. `.github/pull_request_template.md`
carries the definition of done from `specs/constitution.md`.

## Cloud

Everything about AWS — what is created, what it costs, the order to bring an
environment up, how secrets are handled, and what is deliberately left out —
is in **[`terraform/README.md`](terraform/README.md)**.

Deploying and rolling back is described at the top of
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
