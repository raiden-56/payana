variable "aws_region" {
  description = "Region for everything except CloudFront (which is global)."
  type        = string
  default     = "ap-south-1"
}

# --- Names and certificates ----------------------------------------------------------

variable "domain_names" {
  description = "Public host names of the site, e.g. [\"staging.example.in\"]. Empty = use the generated cloudfront.net name."
  type        = list(string)
  default     = []
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate in us-east-1 covering domain_names. Required when domain_names is set."
  type        = string
  default     = null
}

variable "api_origin_domain_name" {
  description = "Host name CloudFront uses to reach the load balancer, e.g. \"origin.staging.example.in\". You create its DNS record (see README)."
  type        = string
}

variable "alb_certificate_arn" {
  description = "ACM certificate in aws_region covering api_origin_domain_name."
  type        = string
}

# --- Application configuration ----------------------------------------------------------

variable "app_name" {
  type    = string
  default = "Payana"
}

variable "api_node_env" {
  description = "NODE_ENV of the API. Leave \"production\" unless you have read \"Signing in on staging\" in the README."
  type        = string
  default     = "production"
}

variable "sms_driver" {
  description = "How one-time codes are sent: \"provider\" (a real SMS gateway) or \"dev\" (codes returned in API responses; the API refuses it when NODE_ENV is production)."
  type        = string
  default     = "provider"

  validation {
    condition     = contains(["provider", "dev"], var.sms_driver)
    error_message = "sms_driver must be \"provider\" or \"dev\"."
  }
}

variable "payment_provider" {
  description = "\"manual\" (no money moves) or \"razorpay\"."
  type        = string
  default     = "manual"

  validation {
    condition     = contains(["manual", "razorpay"], var.payment_provider)
    error_message = "payment_provider must be \"manual\" or \"razorpay\"."
  }
}

variable "extra_api_environment" {
  description = "Additional non-secret environment variables for the API."
  type        = map(string)
  default     = {}
}

variable "integration_secret_keys" {
  description = "Third-party credentials to inject into the API, by JSON key of the \"payana-<env>/api-integrations\" secret, e.g. [\"SMS_API_KEY\"]. Set each value in Secrets Manager before listing its key."
  type        = list(string)
  default     = []
}

variable "content_security_policy" {
  description = "Override for the web Content-Security-Policy. Null = the module default."
  type        = string
  default     = null
}

variable "csp_report_only" {
  description = "Report policy violations without blocking them."
  type        = bool
  default     = false
}

variable "web_acl_arn" {
  description = "AWS WAF web ACL (CLOUDFRONT scope, created in us-east-1) to put in front of the site. Not created by this stack."
  type        = string
  default     = null
}

# --- Operations ---------------------------------------------------------------------------

variable "alert_email" {
  description = "Receives alarm notifications after confirming the subscription email."
  type        = string
  default     = null
}

variable "github_repository" {
  description = "\"owner/name\" of the repository whose deploy workflow may assume the deploy role. Null = do not create the role."
  type        = string
  default     = null
}

variable "create_github_oidc_provider" {
  description = "False if this AWS account already has the GitHub OIDC provider (for example from the other environment)."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# --- Sizing -------------------------------------------------------------------------------

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "db_connections_alarm_threshold" {
  description = "About 80% of max_connections for db_instance_class."
  type        = number
  default     = 80
}

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "cache_node_count" {
  type    = number
  default = 1
}

variable "api_cpu" {
  type    = number
  default = 256
}

variable "api_memory" {
  type    = number
  default = 512
}

variable "api_min_capacity" {
  type    = number
  default = 1
}

variable "api_max_capacity" {
  type    = number
  default = 2
}
