variable "name" {
  description = "Prefix for bucket names, e.g. \"payana-staging\"."
  type        = string
}

variable "web_origins" {
  description = "Origins allowed to upload with a presigned URL, e.g. [\"https://app.example.in\"]."
  type        = list(string)
}

variable "noncurrent_version_days" {
  description = "Days a replaced or deleted object version is kept before permanent removal."
  type        = number
  default     = 30
}

variable "force_destroy" {
  description = "Let `terraform destroy` delete non-empty buckets. Never true in production."
  type        = bool
  default     = false
}
