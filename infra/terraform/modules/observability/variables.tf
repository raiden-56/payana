variable "name" {
  description = "Prefix for resource names, e.g. \"payana-staging\"."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alert_email" {
  description = "Address subscribed to the alerts topic (must confirm by email). Null = no subscription."
  type        = string
  default     = null
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_name" {
  type = string
}

variable "db_instance_identifier" {
  type = string
}

variable "http_5xx_threshold" {
  description = "5xx responses in five minutes that raise an alarm."
  type        = number
  default     = 10
}

variable "db_free_storage_threshold_gb" {
  type    = number
  default = 5
}

variable "db_connections_threshold" {
  description = "Set to roughly 80% of the instance class's max_connections."
  type        = number
  default     = 80
}
