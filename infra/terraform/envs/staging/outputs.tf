output "site_url" {
  value = local.web_origins[0]
}

output "cloudfront_domain_name" {
  description = "Point the site's DNS records (domain_names) at this."
  value       = module.web_hosting.domain_name
}

output "alb_dns_name" {
  description = "Point api_origin_domain_name at this."
  value       = module.api_service.alb_dns_name
}

output "db_bootstrap_command" {
  description = "Run once after the first apply: enables PostGIS and creates the application database role."
  value = join(" ", [
    "aws ecs run-task",
    "--region ${var.aws_region}",
    "--cluster ${module.api_service.cluster_name}",
    "--launch-type FARGATE",
    "--task-definition ${module.api_service.db_bootstrap_task_family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", module.network.private_subnet_ids)}],securityGroups=[${module.network.api_security_group_id}],assignPublicIp=DISABLED}'",
  ])
}

output "integrations_secret_name" {
  description = "Put third-party credentials (SMS gateway, payment gateway) in this Secrets Manager secret."
  value       = module.api_service.integrations_secret_name
}

output "alerts_topic_arn" {
  value = module.observability.alerts_topic_arn
}

output "content_security_policy" {
  value = module.web_hosting.content_security_policy
}

# Copy these into the GitHub Environment of the same name as *variables*
# (Settings > Environments > <name> > Environment variables). None is a secret.
output "github_environment_variables" {
  value = {
    AWS_REGION                 = var.aws_region
    AWS_DEPLOY_ROLE_ARN        = one(module.deploy_role[*].role_arn)
    ECR_REPOSITORY             = module.api_service.ecr_repository_name
    ECS_CLUSTER                = module.api_service.cluster_name
    ECS_SERVICE                = module.api_service.service_name
    ECS_API_TASK_FAMILY        = module.api_service.api_task_family
    ECS_MIGRATE_TASK_FAMILY    = module.api_service.migrate_task_family
    PRIVATE_SUBNET_IDS         = join(",", module.network.private_subnet_ids)
    API_SECURITY_GROUP_ID      = module.network.api_security_group_id
    WEB_BUCKET                 = module.storage.web_bucket_name
    CLOUDFRONT_DISTRIBUTION_ID = module.web_hosting.distribution_id
  }
}
