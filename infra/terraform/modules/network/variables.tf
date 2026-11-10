variable "name" {
  description = "Prefix for resource names, e.g. \"payana-staging\"."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 range of the VPC. Must be a /16 - /20 so the /4 subnet split fits."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Availability zones to spread subnets across."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "single_nat_gateway" {
  description = "One shared NAT gateway (cheaper, a single point of failure) instead of one per zone."
  type        = bool
  default     = false
}

variable "api_port" {
  description = "Port the API container listens on."
  type        = number
  default     = 3000
}
