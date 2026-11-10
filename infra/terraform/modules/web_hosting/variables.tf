variable "name" {
  description = "Prefix for resource names, e.g. \"payana-staging\"."
  type        = string
}

variable "domain_names" {
  description = "Public host names for the site, e.g. [\"app.example.in\"]. Empty = use the generated cloudfront.net name."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ACM certificate in us-east-1 covering domain_names. Required when domain_names is not empty."
  type        = string
  default     = null
}

variable "price_class" {
  description = "PriceClass_200 is the cheapest class that includes Indian edge locations."
  type        = string
  default     = "PriceClass_200"
}

variable "web_acl_arn" {
  description = "Optional AWS WAF web ACL (CLOUDFRONT scope). Not created by this stack."
  type        = string
  default     = null
}

# --- Origins ------------------------------------------------------------------------

variable "web_bucket_name" {
  type = string
}

variable "web_bucket_arn" {
  type = string
}

variable "web_bucket_domain_name" {
  description = "Regional domain name of the web bucket."
  type        = string
}

variable "uploads_bucket_domain_name" {
  description = "Regional domain name of the uploads bucket, allowed in the default Content-Security-Policy."
  type        = string
}

variable "api_origin_domain_name" {
  description = "Host name CloudFront uses to reach the load balancer. Needs a DNS record pointing at the load balancer and must be covered by the load balancer certificate."
  type        = string
}

variable "origin_verify_header_name" {
  type    = string
  default = "X-Origin-Verify"
}

variable "origin_verify_header_value" {
  description = "Shared secret added to every request sent to the load balancer."
  type        = string
  sensitive   = true
}

# --- Response headers -----------------------------------------------------------------

variable "content_security_policy" {
  description = "Full Content-Security-Policy for the web application. Null = the default built in main.tf, which allows the Google Analytics / Ads / AdSense hosts."
  type        = string
  default     = null

  validation {
    condition     = var.content_security_policy == null ? true : length(var.content_security_policy) <= 1783
    error_message = "CloudFront limits a response header value to 1783 characters."
  }
}

variable "csp_report_only" {
  description = "Send the policy as Content-Security-Policy-Report-Only: violations are logged in the browser, nothing is blocked. Use while trialling a policy."
  type        = bool
  default     = false
}

variable "permissions_policy" {
  description = "Browser features the site may use. Location and camera are needed for pickup points and document capture."
  type        = string
  default     = "geolocation=(self), camera=(self), microphone=(), payment=(self)"
}

variable "hsts_include_subdomains" {
  description = "Apply HSTS to subdomains too. Leave false if other sites on subdomains are not yet HTTPS-only."
  type        = bool
  default     = false
}
