variable "name" {
  description = "Prefix for resource names; also the replication group id (max 40 characters)."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the cache nodes."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group that admits Redis traffic from the API."
  type        = string
}

variable "engine" {
  description = "\"valkey\" (Redis-protocol compatible, lower node price) or \"redis\"."
  type        = string
  default     = "valkey"
}

variable "engine_version" {
  type    = string
  default = "8.0"
}

variable "parameter_group_name" {
  description = "Must match the engine and major version."
  type        = string
  default     = "default.valkey8"
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "node_count" {
  description = "1 = single node. 2 or more = a replica per extra node with automatic failover."
  type        = number
  default     = 1
}

variable "snapshot_retention_days" {
  description = "Daily snapshots to keep. 0 = none; the cache holds no data that cannot be rebuilt."
  type        = number
  default     = 0
}

variable "apply_immediately" {
  type    = bool
  default = false
}
