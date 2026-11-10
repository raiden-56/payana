variable "name" {
  description = "Prefix for resource names, e.g. \"payana-staging\" (max 28 characters)."
  type        = string

  validation {
    condition     = length(var.name) <= 28
    error_message = "name must be at most 28 characters so load balancer names stay within 32."
  }
}

# --- Network ------------------------------------------------------------------------

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Subnets for the load balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnets for the API tasks."
  type        = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "api_security_group_id" {
  type = string
}

# --- Load balancer --------------------------------------------------------------------

variable "alb_certificate_arn" {
  description = "ACM certificate in this region covering the host name CloudFront uses to reach the load balancer."
  type        = string
}

variable "origin_verify_header_name" {
  type    = string
  default = "X-Origin-Verify"
}

variable "origin_verify_header_value" {
  description = "Shared secret CloudFront adds to every origin request; the listener rejects requests without it."
  type        = string
  sensitive   = true
}

variable "deletion_protection" {
  description = "Protect the load balancer from deletion."
  type        = bool
  default     = true
}

# --- Container ------------------------------------------------------------------------

variable "image_tag" {
  description = "Tag in the task definitions Terraform registers. The deploy workflow registers its own revisions per release, so this only matters before the first deploy."
  type        = string
  default     = "bootstrap"
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64. Must match the architecture the deploy workflow builds."
  type        = string
  default     = "X86_64"
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "container_user" {
  description = "Non-root user the container runs as. 1000 is `node` in the official Node images."
  type        = string
  default     = "1000:1000"
}

variable "cpu" {
  description = "Fargate CPU units for one API task."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate memory (MiB) for one API task."
  type        = number
  default     = 1024
}

variable "liveness_path" {
  type    = string
  default = "/api/v1/health/live"
}

variable "readiness_path" {
  type    = string
  default = "/api/v1/health/ready"
}

variable "migration_command" {
  description = "Command the migrate task runs inside the API image, relative to its working directory. The npm script `migration:run` is not usable here: it rebuilds first, and the production image has no build tools."
  type        = list(string)
  default     = ["node", "dist/database/migrate.js", "up"]
}

variable "node_env" {
  description = "NODE_ENV for the API. \"production\" refuses the development SMS driver (which returns one-time codes in API responses)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "development"], var.node_env)
    error_message = "node_env must be \"production\" or \"development\"."
  }
}

variable "environment_variables" {
  description = "Non-secret environment for the API (APP_NAME, CORS_ORIGINS, SMS_DRIVER, PAYMENT_PROVIDER, ...). NODE_ENV, PORT, TRUST_PROXY, DATABASE_SSL and the storage settings are added by this module."
  type        = map(string)
  default     = {}
}

variable "integration_secret_keys" {
  description = "JSON keys of the \"<name>/api-integrations\" secret to inject as environment variables, e.g. [\"SMS_API_KEY\"]. Set the value in Secrets Manager first, then list the key here."
  type        = list(string)
  default     = []
}

variable "log_group_name" {
  type = string
}

variable "image_retention_count" {
  description = "Images kept in the registry; older ones expire. This bounds how far back a rollback can go."
  type        = number
  default     = 30
}

variable "force_delete" {
  description = "Let `terraform destroy` delete a registry that still holds images. Never true in production."
  type        = bool
  default     = false
}

# --- Scaling ----------------------------------------------------------------------------

variable "desired_count" {
  description = "Tasks at creation. Autoscaling owns the count afterwards."
  type        = number
  default     = 1
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "max_capacity" {
  type    = number
  default = 2
}

variable "cpu_target_percent" {
  description = "Average CPU the autoscaler holds the service at."
  type        = number
  default     = 60
}

# --- Dependencies -------------------------------------------------------------------------

variable "uploads_bucket_name" {
  type = string
}

variable "uploads_bucket_arn" {
  type = string
}

variable "database_address" {
  type = string
}

variable "database_port" {
  type    = number
  default = 5432
}

variable "database_name" {
  type = string
}

variable "database_master_secret_arn" {
  description = "RDS-managed master credentials. Read only by the db-bootstrap task."
  type        = string
}

variable "app_database_user" {
  description = "PostgreSQL role the API and its migrations connect as."
  type        = string
  default     = "payana_app"
}

variable "database_ssl" {
  description = "Sets DATABASE_SSL: the API connects over TLS and verifies the server certificate. RDS refuses unencrypted connections, so this stays true."
  type        = bool
  default     = true
}

variable "database_ca_bundle_path" {
  description = "Path inside the API image of the Amazon RDS certificate bundle (https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem), exported as NODE_EXTRA_CA_CERTS. Empty = do not set it."
  type        = string
  default     = "/etc/ssl/certs/rds-global-bundle.pem"
}

variable "database_url_params" {
  description = "Optional query string appended to DATABASE_URL, without the leading \"?\"."
  type        = string
  default     = ""
}

variable "redis_address" {
  type = string
}

variable "redis_port" {
  type    = number
  default = 6379
}

variable "redis_auth_token" {
  type      = string
  sensitive = true
}

variable "secret_recovery_window_days" {
  description = "Days a deleted secret can be restored. 0 deletes at once, which lets a torn-down staging stack be recreated under the same name."
  type        = number
  default     = 30
}

variable "db_bootstrap_image" {
  description = "Image providing psql for the one-off database bootstrap task."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:17-alpine"
}
