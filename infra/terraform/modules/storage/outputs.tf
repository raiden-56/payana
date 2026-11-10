output "uploads_bucket_name" {
  value = aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "uploads_bucket_domain_name" {
  description = "Regional host name of the uploads bucket (for the Content-Security-Policy)."
  value       = aws_s3_bucket.uploads.bucket_regional_domain_name
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.id
}

output "web_bucket_arn" {
  value = aws_s3_bucket.web.arn
}

output "web_bucket_domain_name" {
  value = aws_s3_bucket.web.bucket_regional_domain_name
}
