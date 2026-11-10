data "aws_region" "current" {}

locals {
  region = data.aws_region.current.name
  image  = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"

  # Non-secret configuration. Map iteration is key-sorted, so the rendered
  # container definition is stable between plans.
  environment = [
    for k, v in merge(
      var.environment_variables,
      {
        NODE_ENV     = var.node_env
        PORT         = tostring(var.container_port)
        DATABASE_SSL = tostring(var.database_ssl)
        # Every deployed environment is HTTPS-only, whatever NODE_ENV says.
        COOKIE_SECURE  = "true"
        STORAGE_DRIVER = "s3"
        S3_BUCKET      = var.uploads_bucket_name
        S3_REGION      = local.region
        # Proxies in front of the API: CloudFront, then the load balancer.
        # With this, the API sees the real client address for rate limiting.
        TRUST_PROXY = "2"
      },
      # RDS certificates are issued by Amazon's own authority, which Node does
      # not trust out of the box. The image must ship the RDS bundle here.
      { for k, v in { NODE_EXTRA_CA_CERTS = var.database_ca_bundle_path } : k => v if var.database_ssl && v != "" },
    ) : { name = k, value = v }
  ]

  # Each entry reads one JSON key of a Secrets Manager secret at task start.
  app_secret_keys = ["DATABASE_URL", "DATA_ENCRYPTION_KEY", "JWT_ACCESS_SECRET", "REDIS_URL", "SIGNING_SECRET"]
  secrets = concat(
    [for k in local.app_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [for k in sort(var.integration_secret_keys) : { name = k, valueFrom = "${aws_secretsmanager_secret.integrations.arn}:${k}::" }],
  )

  log_options = {
    awslogs-group  = var.log_group_name
    awslogs-region = local.region
  }
}

# --- Image registry -----------------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name = "${var.name}-api"
  # Tags are git SHAs and never move, so a tag is a reliable rollback target.
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.force_delete

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the most recent ${var.image_retention_count} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.image_retention_count
      }
      action = { type = "expire" }
    }]
  })
}

# --- Application secret ---------------------------------------------------------------
# Generated here and stored in Secrets Manager; never placed in tfvars or the
# repository. The values do pass through Terraform state, so the state bucket
# must be encrypted and access to it restricted (see infra/terraform/README.md).

resource "random_password" "app_database" {
  length  = 40
  special = false # goes into a connection URL
}

resource "random_password" "jwt_access" {
  length  = 64
  special = false
}

resource "random_password" "signing" {
  length  = 64
  special = false
}

# AES-256 key the API uses to encrypt MFA secrets and document numbers at rest.
# NEVER replace this resource on a live environment: everything encrypted with
# the old key becomes unreadable. Back the value up outside AWS.
resource "random_bytes" "data_encryption_key" {
  length = 32
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/api"
  description             = "Runtime secrets of the Payana API (JSON keys injected into the task)."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    DATABASE_URL = format(
      "postgresql://%s:%s@%s:%d/%s%s",
      var.app_database_user,
      random_password.app_database.result,
      var.database_address,
      var.database_port,
      var.database_name,
      var.database_url_params == "" ? "" : "?${var.database_url_params}",
    )
    # Read only by the db-bootstrap task, which creates the role with it.
    DATABASE_PASSWORD   = random_password.app_database.result
    REDIS_URL           = format("rediss://:%s@%s:%d", var.redis_auth_token, var.redis_address, var.redis_port)
    JWT_ACCESS_SECRET   = random_password.jwt_access.result
    SIGNING_SECRET      = random_password.signing.result
    DATA_ENCRYPTION_KEY = random_bytes.data_encryption_key.base64
  })
}

# Credentials issued by third parties (SMS gateway, payment gateway). Terraform
# creates the empty container; an operator sets the values in Secrets Manager
# and they never enter Terraform state. A key is injected into the API only
# once it is listed in var.integration_secret_keys - list it after setting it,
# because a task cannot start if a listed key is missing.
resource "aws_secretsmanager_secret" "integrations" {
  name                    = "${var.name}/api-integrations"
  description             = "Third-party credentials for the Payana API. Values are set by an operator, not by Terraform."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "integrations" {
  secret_id     = aws_secretsmanager_secret.integrations.id
  secret_string = "{}"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- IAM --------------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by the ECS agent to pull the image, write logs and inject secrets.
# The application code cannot assume it.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-api-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid     = "InjectSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.app.arn,
      aws_secretsmanager_secret.integrations.arn,
      var.database_master_secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "inject-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# What the running API may do in AWS: the uploads bucket, and nothing else.
resource "aws_iam_role" "task" {
  name               = "${var.name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task_uploads" {
  statement {
    sid       = "UploadsObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.uploads_bucket_arn}/*"]
  }

  statement {
    sid       = "UploadsList"
    actions   = ["s3:ListBucket"]
    resources = [var.uploads_bucket_arn]
  }
}

resource "aws_iam_role_policy" "task_uploads" {
  name   = "uploads-bucket"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_uploads.json
}

# --- Cluster and task definitions ---------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name            = "api"
    image           = local.image
    essential       = true
    user            = var.container_user
    stopTimeout     = 30
    portMappings    = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment     = local.environment
    secrets         = local.secrets
    linuxParameters = { initProcessEnabled = true }
    healthCheck = {
      # Node's built-in fetch, so the image needs no curl or wget.
      command = [
        "CMD", "node", "-e",
        "fetch('http://127.0.0.1:${var.container_port}${var.liveness_path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { awslogs-stream-prefix = "api" })
    }
  }])
}

# Same image and configuration as the service, run once per deploy before the
# new code takes traffic. Needs no AWS permissions of its own.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name        = "migrate"
    image       = local.image
    essential   = true
    user        = var.container_user
    command     = var.migration_command
    environment = local.environment
    secrets     = local.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { awslogs-stream-prefix = "migrate" })
    }
  }])
}

# One-off, run by hand after the first apply (and again only if the application
# database password is regenerated). Connects as the RDS master user to do the
# two things the application role cannot: enable PostGIS and create that role.
resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${var.name}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name       = "db-bootstrap"
    image      = var.db_bootstrap_image
    essential  = true
    user       = "postgres"
    entryPoint = ["sh", "-c"]
    command    = [file("${path.module}/db-bootstrap.sh")]
    environment = [
      { name = "APP_DB_USER", value = var.app_database_user },
      { name = "PGDATABASE", value = var.database_name },
      { name = "PGHOST", value = var.database_address },
      { name = "PGPORT", value = tostring(var.database_port) },
      { name = "PGSSLMODE", value = "require" },
    ]
    secrets = [
      { name = "APP_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_PASSWORD::" },
      { name = "PGPASSWORD", valueFrom = "${var.database_master_secret_arn}:password::" },
      { name = "PGUSER", valueFrom = "${var.database_master_secret_arn}:username::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { awslogs-stream-prefix = "db-bootstrap" })
    }
  }])
}

# --- Load balancer ----------------------------------------------------------------------------
# Public so CloudFront can reach it, but closed twice over: the security group
# admits only CloudFront's address ranges, and the listener forwards only
# requests carrying the shared-secret header that our distribution adds.

resource "aws_lb" "this" {
  name                       = "${var.name}-api"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [var.alb_security_group_id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
  idle_timeout               = 60
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.name}-api"
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = var.readiness_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    http_header {
      http_header_name = var.origin_verify_header_name
      values           = [var.origin_verify_header_value]
    }
  }
}

# --- Service and autoscaling ---------------------------------------------------------------------

resource "aws_ecs_service" "api" {
  name             = "${var.name}-api"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.api.arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  health_check_grace_period_seconds  = 90
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # A release whose tasks never become healthy is rolled back automatically.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.api_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.container_port
  }

  lifecycle {
    # The deploy workflow registers a new task definition revision per release
    # and autoscaling owns the task count; Terraform must not undo either.
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [
    aws_lb_listener_rule.from_cloudfront,
    aws_secretsmanager_secret_version.app,
    aws_iam_role_policy.execution_secrets,
  ]
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  resource_id        = aws_appautoscaling_target.api.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.cpu_target_percent
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
