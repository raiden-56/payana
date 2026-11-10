output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "domain_name" {
  description = "The cloudfront.net name. Point the site's DNS records at this."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "hosted_zone_id" {
  value = aws_cloudfront_distribution.this.hosted_zone_id
}

output "content_security_policy" {
  description = "The policy in effect, for review."
  value       = local.csp
}

output "api_path_pattern" {
  description = "Path pattern routed to the API instead of the web bucket."
  value       = local.api_path_pattern
}

output "has_custom_error_responses" {
  description = "Must stay false: custom error responses apply to every behaviour, including the API."
  value       = length(aws_cloudfront_distribution.this.custom_error_response) > 0
}
