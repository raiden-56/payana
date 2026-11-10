variable "name" {
  description = "Prefix for resource names, e.g. \"payana-staging\"."
  type        = string
}

variable "github_repository" {
  description = "Repository allowed to deploy, as \"owner/name\"."
  type        = string
}

variable "github_environment" {
  description = "GitHub Environment the deploy job must run in, e.g. \"staging\"."
  type        = string
}

variable "create_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider. False when another stack in the same AWS account already created it."
  type        = bool
  default     = true
}

variable "ecr_repository_arn" {
  type = string
}

variable "ecs_cluster_arn" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_arn" {
  type = string
}

variable "task_families" {
  description = "Task definition families the workflow may run (the migration task)."
  type        = list(string)
}

variable "pass_role_arns" {
  description = "Task and execution roles the workflow may attach to task definitions it registers."
  type        = list(string)
}

variable "web_bucket_arn" {
  type = string
}

variable "cloudfront_distribution_arn" {
  type = string
}
