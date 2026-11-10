output "ecr_repository_name" {
  value = aws_ecr_repository.api.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.api.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "service_arn" {
  value = aws_ecs_service.api.id
}

output "api_task_family" {
  value = aws_ecs_task_definition.api.family
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "db_bootstrap_task_family" {
  value = aws_ecs_task_definition.db_bootstrap.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "app_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "integrations_secret_name" {
  description = "Secret an operator fills with third-party credentials."
  value       = aws_secretsmanager_secret.integrations.name
}

output "alb_dns_name" {
  description = "Point the API origin host name (a DNS record you manage) at this."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "alb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}
