# Payana on AWS — Terraform

> **Status: validated, never applied.** `terraform fmt`, `terraform validate`
> and `terraform test` (an offline plan against a mocked AWS provider) pass for
> both environments on Terraform 1.9.8 with AWS provider 5.100.0. Nothing here
> has been planned or applied against a real AWS account yet, so expect to fix
> account-specific details (quotas, instance availability, certificate and DNS
> timing) on the first staging apply. Apply staging before production.

## What it creates

One stack per environment (`envs/staging`, `envs/production`), default region
`ap-south-1` (Mumbai), composed from the modules below.

```
Browser ──HTTPS──▶ CloudFront ──┬── everything else ─▶ S3 web bucket (private, OAC)
                                │                      index.html for app routes
                                └── /api/* ──HTTPS──▶ ALB ─▶ ECS Fargate (API :3000)
                                                               ├─▶ RDS PostgreSQL 17 (+PostGIS)
                                                               ├─▶ ElastiCache (Valkey, Redis protocol)
                                                               └─▶ S3 uploads bucket (private)
```

| Module | Creates |
| --- | --- |
| `network` | VPC over two zones, public and private subnets, NAT (one in staging, one per zone in production), S3 gateway endpoint, and four security groups whose only allowed paths are CloudFront → ALB :443 → API :3000 → PostgreSQL :5432 / Redis :6379. |
| `database` | RDS PostgreSQL 17: private, encrypted, TLS-only, automated backups with point-in-time recovery; Multi-AZ and deletion protection in production. The master password is generated and rotated by RDS in Secrets Manager. |
| `cache` | ElastiCache replication group: private, encrypted at rest and in transit, AUTH token; a replica with automatic failover in production. |
| `storage` | Uploads bucket (private, encrypted, versioned, CORS for presigned browser uploads, lifecycle) and web bucket (private, read only by CloudFront). |
| `api_service` | ECR repository (immutable tags), ECS cluster, Fargate service with CPU autoscaling and deployment circuit breaker, task definitions for the API, for migrations and for the one-off database bootstrap, the load balancer, the application secrets, and IAM roles (the running API can touch the uploads bucket and nothing else). |
| `web_hosting` | CloudFront distribution, single-page-app rewrite function, cache policy, security response headers including the Content-Security-Policy. |
| `observability` | Log group with retention, SNS alerts topic, alarms: load balancer 5xx, API 5xx, unhealthy targets, API CPU and memory, database CPU, free storage and connections. |
| `deploy_role` | The IAM role GitHub Actions assumes through OIDC to deploy (created when `github_repository` is set). No access keys. |

Three design points worth knowing before changing anything:

- **The load balancer is public but closed.** CloudFront needs a public origin,
  so the ALB's security group admits only CloudFront's address ranges and its
  listener forwards only requests carrying a shared-secret header that the
  distribution adds. Everything else gets `403`.
- **App-route fallback never touches the API.** `/explore` and other app routes
  are rewritten to `index.html` by a CloudFront Function attached to the S3
  behaviour only. The distribution has no `custom_error_response` blocks,
  because those apply to every behaviour and would turn an API `404` into the
  web page. A test pins this.
- **Caching follows each file's `Cache-Control`**, which the deploy workflow
  sets: content-hashed bundles are immutable for a year; `index.html`,
  `ngsw.json`, `ngsw-worker.js` and `app-config.json` are `no-cache` and are
  revalidated on every request. `/api/*` is never cached.

## What you pay for

No prices are quoted here — check the AWS calculator for `ap-south-1`. The
items that drive the bill, largest first for a small deployment:

1. **NAT gateway** — an hourly charge per gateway plus per-GB processing.
   Production runs two. Often the largest fixed cost at low traffic.
2. **RDS** — instance hours (doubled by Multi-AZ in production), storage, and
   backup storage beyond the free allowance.
3. **Application Load Balancer** — hourly charge plus capacity units.
4. **Fargate** — vCPU-hours and GB-hours for every running API task (two or
   more in production), plus the brief migration task on each deploy.
5. **ElastiCache** — node hours (two nodes in production).
6. **CloudWatch** — log ingestion and storage, Container Insights metrics,
   alarms.
7. **CloudFront and data transfer** — requests and GB out; grows with traffic.
8. **Small fixed items** — Secrets Manager (three secrets per environment),
   ECR image storage, S3 storage and requests.

Staging is sized to minimise items 1–5: one NAT gateway, `db.t4g.micro`
single-AZ, one cache node, one small API task. Destroy it when it is not needed.

## Before you start

- **AWS accounts.** Ideally one for staging and one for production. If they
  share an account, set `create_github_oidc_provider = false` in whichever
  environment is applied second.
- **Terraform ≥ 1.9** and AWS credentials with rights to create the above.
- **A domain you control**, and two ACM certificates per environment, both
  DNS-validated:
  - one in **`ap-south-1`** for the *origin host name* — the name CloudFront
    uses to reach the load balancer, e.g. `origin.example.in`;
  - one in **`us-east-1`** for the *site host name*, e.g. `app.example.in`
    (CloudFront only accepts certificates from that region). Staging may skip
    this and use the generated `cloudfront.net` name.
- **A state bucket and lock table**, created once per account by hand:

  ```sh
  aws s3api create-bucket --bucket payana-terraform-state-<account-id> \
    --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1
  aws s3api put-bucket-versioning --bucket payana-terraform-state-<account-id> \
    --versioning-configuration Status=Enabled
  aws s3api put-public-access-block --bucket payana-terraform-state-<account-id> \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws dynamodb create-table --table-name payana-terraform-locks --region ap-south-1 \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST
  ```

  **The state file contains generated secrets** (see below). Restrict the
  bucket to the people and roles that run Terraform.

## Bootstrap order

Per environment, shown for staging:

1. **Configure.**
   ```sh
   cd infra/terraform/envs/staging
   cp backend.hcl.example backend.hcl                 # set the bucket name
   cp terraform.tfvars.example terraform.tfvars       # set host names and certificate ARNs
   terraform init -backend-config=backend.hcl
   ```
2. **Apply.** `terraform plan -out tfplan`, read it, `terraform apply tfplan`.
   Allow 20–30 minutes (RDS and CloudFront are slow). The ECS service will
   report failing tasks until step 6 — its image does not exist yet. That is
   expected.
3. **DNS** (not managed here). Create two records:
   - origin host name → the `alb_dns_name` output;
   - site host name(s) → the `cloudfront_domain_name` output.
4. **Bootstrap the database** — once. This enables PostGIS and creates the
   role the API connects as; the application role cannot do either itself.
   ```sh
   eval "$(terraform output -raw db_bootstrap_command)"
   ```
   Check the task exited 0 (ECS console, or the `db-bootstrap` log stream).
5. **Connect GitHub.** Create a GitHub Environment named `staging` (add
   required reviewers for `production`) and copy every entry of
   `terraform output github_environment_variables` into it as environment
   *variables*. None is a secret.
6. **Deploy.** Run the *Deploy* workflow (`.github/workflows/deploy.yml`). It
   builds and pushes the API image, runs migrations, starts the service, then
   publishes the web app.
7. **Confirm the alert subscription** email sent to `alert_email`.

Initial reference data and the first administrator account are an application
concern, not an infrastructure one — see `specs/deployment/release-plan.md`.

## Secrets

Nothing secret goes in `terraform.tfvars`, in Git, or in GitHub. At runtime the
API receives every secret from AWS Secrets Manager, injected by ECS.

| Secret | Holds | Who sets it |
| --- | --- | --- |
| RDS-managed (`rds!db-…`) | Database master user and password | RDS generates and rotates it. Never in Terraform state. Used only by the one-off bootstrap task. |
| `payana-<env>/api` | `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `SIGNING_SECRET`, `DATA_ENCRYPTION_KEY` | Terraform generates the values. **They are therefore in the state file.** |
| `payana-<env>/api-integrations` | Third-party credentials: SMS gateway, payment gateway | You, in the Secrets Manager console or CLI. Terraform creates it empty and never reads the values. |

To hand a third-party credential to the API: add it as a JSON key to
`payana-<env>/api-integrations`, **then** list that key in
`integration_secret_keys` and apply. (In that order: a task cannot start if a
listed key is missing.) The next deploy picks it up.

**`DATA_ENCRYPTION_KEY` encrypts MFA secrets and document numbers in the
database. If it is lost or regenerated, that data is unrecoverable.** Keep a
copy outside AWS, and never `-replace` `random_bytes.data_encryption_key` on an
environment that holds data.

To rotate the application database password: `terraform apply
-replace=module.api_service.random_password.app_database`, run the database
bootstrap command again (it re-syncs the role), then redeploy.

## Day to day

```sh
cd infra/terraform/envs/<staging|production>
terraform init -backend-config=backend.hcl    # after a fresh clone or a provider bump
terraform plan -out tfplan
terraform apply tfplan
```

- **Releases do not go through Terraform.** The deploy workflow registers a
  new task definition revision per release; the service ignores Terraform's
  copy after creation. A configuration change made here (an environment
  variable, CPU, memory) is carried into the *next* deploy, so apply, then
  run the workflow.
- **Checks without credentials.** `terraform fmt -check -recursive`,
  `terraform validate` and `terraform test` need no AWS access and run in CI.
- Commit `.terraform.lock.hcl`. It pins the provider builds.

## Decisions to make before the first deploy

These are settings the code cannot choose for you.

- **Signing in on staging.** With `NODE_ENV=production` the API refuses the
  development SMS driver, and the real gateway driver (`SMS_DRIVER=provider`)
  is not implemented in the API yet — so, as configured by default, **nobody
  can sign in to a deployed environment by phone until an SMS gateway adapter
  exists.** Staging can set `api_node_env = "development"` and
  `sms_driver = "dev"`: one-time codes are then returned in the API response,
  which means *anyone who can reach the site can sign in as any phone number*.
  Do that only with access to staging restricted (a WAF IP allow-list via
  `web_acl_arn`), never with real customer data, and never in production.
- **Content-Security-Policy.** The default allows the Google Analytics, Google
  Ads and AdSense hosts so those integrations work when their IDs are added.
  It has not been exercised against the built application. Start staging with
  `csp_report_only = true`, watch the browser console, then enforce. AdSense
  in particular tends to need a looser policy than conversion tracking; if
  display ads stay off, remove its hosts by setting `content_security_policy`.
- **`hsts_include_subdomains`** (module `web_hosting`) is off. Turn it on once
  every subdomain of the site's domain is HTTPS-only.

## What the API image must provide

The task definitions assume the following of `apps/api/Dockerfile`. Each is a
variable on `modules/api_service` if the image differs.

| Assumption | Variable |
| --- | --- |
| Runs correctly as non-root UID 1000 (`node` in the official images) | `container_user` |
| `node` on `PATH`; working directory contains `dist/main.js` and `dist/database/migrate.js` | `migration_command` |
| The Amazon RDS certificate bundle at `/etc/ssl/certs/rds-global-bundle.pem` (the API verifies the database certificate; without the bundle it cannot connect) | `database_ca_bundle_path` |
| Built for `linux/amd64` | `cpu_architecture` |
| Listens on `PORT` (3000); `/api/v1/health/live` and `/api/v1/health/ready` return 200 | `container_port`, `liveness_path`, `readiness_path` |

## Not covered

- **DNS.** No Route 53 zones or records; create the two records in step 3
  wherever the domain is hosted.
- **Certificates.** ACM certificates are inputs, not resources.
- **WAF.** None is created. `web_acl_arn` attaches one you build (rate limits
  and managed rule groups are recommended before public launch; OTP endpoints
  are an obvious abuse target).
- **SMS, email and payments.** No SNS SMS, SES, or gateway accounts. India
  requires DLT registration of SMS sender IDs and templates — a business
  process, not Terraform.
- **Backup testing.** Backups and point-in-time recovery are on; nothing here
  proves a restore works. Schedule a restore drill.
- **Cross-region disaster recovery**, read replicas, and RDS Proxy.
- **Load balancer and CloudFront access logs, VPC flow logs, CloudTrail,
  GuardDuty.** Account-level security tooling is assumed to exist elsewhere.
- **Dashboards and tracing.** Alarms and logs only.
- **Cost controls.** No budgets or anomaly alerts.
- **The state bucket itself**, and the GitHub Environments and their reviewers.
