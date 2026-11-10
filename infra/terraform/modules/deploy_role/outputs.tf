output "role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in the GitHub Environment."
  value       = aws_iam_role.deploy.arn
}

output "trusted_subject" {
  description = "The only GitHub OIDC subject allowed to assume the role."
  value       = "repo:${var.github_repository}:environment:${var.github_environment}"
}
