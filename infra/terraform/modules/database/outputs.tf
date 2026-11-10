output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "database_name" {
  value = aws_db_instance.this.db_name
}

output "instance_identifier" {
  value = aws_db_instance.this.identifier
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret (JSON: username, password) that RDS owns and rotates."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "multi_az" {
  value = aws_db_instance.this.multi_az
}

output "deletion_protection" {
  value = aws_db_instance.this.deletion_protection
}
