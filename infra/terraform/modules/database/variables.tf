variable "name" {
  description = "Prefix for resource names; also the RDS instance identifier."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the instance (at least two zones)."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group that admits PostgreSQL traffic from the API."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL version. A major version only (\"17\") follows RDS minor releases."
  type        = string
  default     = "17"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  description = "Ceiling for storage autoscaling."
  type        = number
  default     = 100
}

variable "database_name" {
  type    = string
  default = "payana"
}

variable "master_username" {
  description = "Administrative login. The application does not use it; it connects as its own role."
  type        = string
  default     = "payana_admin"
}

variable "multi_az" {
  description = "Synchronous standby in a second zone."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Days of automated backups and point-in-time recovery. 1 - 35."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35 (0 would switch backups off)."
  }
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "skip_final_snapshot" {
  description = "Skip the snapshot taken when the instance is destroyed. Never true in production."
  type        = bool
  default     = false
}

variable "apply_immediately" {
  description = "Apply modifications now instead of in the maintenance window."
  type        = bool
  default     = false
}
