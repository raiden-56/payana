# Staging: the same shape as production at the smallest sizes, and disposable -
# `terraform destroy` removes everything, data included.
#
# envs/staging/main.tf and envs/production/main.tf differ only in this block.
locals {
  environment = "staging"
  # Deletion protection, final snapshots, non-empty-bucket guards, a NAT
  # gateway per zone and a recovery window on secrets.
  protected = false
}

locals {
  name = "payana-${local.environment}"

  # Where browsers load the site from: the custom domains when configured,
  # otherwise the generated cloudfront.net name.
  web_origins = length(var.domain_names) > 0 ? [for d in var.domain_names : "https://${d}"] : ["https://${module.web_hosting.domain_name}"]
}

# Shared secret between CloudFront and the load balancer (see modules/api_service).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

module "network" {
  source = "../../modules/network"

  name               = local.name
  vpc_cidr           = var.vpc_cidr
  single_nat_gateway = !local.protected
}

module "database" {
  source = "../../modules/database"

  name                  = local.name
  subnet_ids            = module.network.private_subnet_ids
  security_group_id     = module.network.database_security_group_id
  instance_class        = var.db_instance_class
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = local.protected
  skip_final_snapshot   = !local.protected
  apply_immediately     = !local.protected
}

module "cache" {
  source = "../../modules/cache"

  name              = local.name
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.cache_security_group_id
  node_type         = var.cache_node_type
  node_count        = var.cache_node_count
  apply_immediately = !local.protected
}

module "storage" {
  source = "../../modules/storage"

  name          = local.name
  web_origins   = local.web_origins
  force_destroy = !local.protected
}

module "observability" {
  source = "../../modules/observability"

  name                     = local.name
  log_retention_days       = var.log_retention_days
  alert_email              = var.alert_email
  alb_arn_suffix           = module.api_service.alb_arn_suffix
  target_group_arn_suffix  = module.api_service.target_group_arn_suffix
  ecs_cluster_name         = module.api_service.cluster_name
  ecs_service_name         = module.api_service.service_name
  db_instance_identifier   = module.database.instance_identifier
  db_connections_threshold = var.db_connections_alarm_threshold
}

module "api_service" {
  source = "../../modules/api_service"

  name = local.name

  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  private_subnet_ids    = module.network.private_subnet_ids
  alb_security_group_id = module.network.alb_security_group_id
  api_security_group_id = module.network.api_security_group_id

  alb_certificate_arn        = var.alb_certificate_arn
  origin_verify_header_value = random_password.origin_verify.result
  deletion_protection        = local.protected
  force_delete               = !local.protected

  cpu           = var.api_cpu
  memory        = var.api_memory
  desired_count = var.api_min_capacity
  min_capacity  = var.api_min_capacity
  max_capacity  = var.api_max_capacity

  log_group_name = module.observability.api_log_group_name

  node_env = var.api_node_env
  environment_variables = merge(var.extra_api_environment, {
    APP_NAME         = var.app_name
    CORS_ORIGINS     = join(",", local.web_origins)
    SMS_DRIVER       = var.sms_driver
    PAYMENT_PROVIDER = var.payment_provider
  })
  integration_secret_keys = var.integration_secret_keys

  uploads_bucket_name = module.storage.uploads_bucket_name
  uploads_bucket_arn  = module.storage.uploads_bucket_arn

  database_address           = module.database.address
  database_port              = module.database.port
  database_name              = module.database.database_name
  database_master_secret_arn = module.database.master_user_secret_arn

  redis_address    = module.cache.address
  redis_port       = module.cache.port
  redis_auth_token = module.cache.auth_token

  secret_recovery_window_days = local.protected ? 30 : 0
}

module "web_hosting" {
  source = "../../modules/web_hosting"

  name                = local.name
  domain_names        = var.domain_names
  acm_certificate_arn = var.cloudfront_certificate_arn

  web_bucket_name            = module.storage.web_bucket_name
  web_bucket_arn             = module.storage.web_bucket_arn
  web_bucket_domain_name     = module.storage.web_bucket_domain_name
  uploads_bucket_domain_name = module.storage.uploads_bucket_domain_name

  api_origin_domain_name     = var.api_origin_domain_name
  origin_verify_header_value = random_password.origin_verify.result

  content_security_policy = var.content_security_policy
  csp_report_only         = var.csp_report_only
  web_acl_arn             = var.web_acl_arn
}

module "deploy_role" {
  source = "../../modules/deploy_role"
  count  = var.github_repository == null ? 0 : 1

  name                 = local.name
  github_repository    = var.github_repository
  github_environment   = local.environment
  create_oidc_provider = var.create_github_oidc_provider

  ecr_repository_arn = module.api_service.ecr_repository_arn
  ecs_cluster_arn    = module.api_service.cluster_arn
  ecs_cluster_name   = module.api_service.cluster_name
  ecs_service_arn    = module.api_service.service_arn
  task_families      = [module.api_service.migrate_task_family]
  pass_role_arns     = [module.api_service.execution_role_arn, module.api_service.task_role_arn]

  web_bucket_arn              = module.storage.web_bucket_arn
  cloudfront_distribution_arn = module.web_hosting.distribution_arn
}
