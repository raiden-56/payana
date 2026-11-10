# --- Logs -------------------------------------------------------------------------
# One group for everything the API image runs; the stream prefix separates
# the service ("api"), migrations ("migrate") and the one-off database bootstrap.

resource "aws_cloudwatch_log_group" "api" {
  name              = "/${var.name}/api"
  retention_in_days = var.log_retention_days
}

# --- Alerts -----------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alert_email == null ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alb_dimensions = { LoadBalancer = var.alb_arn_suffix }
  ecs_dimensions = { ClusterName = var.ecs_cluster_name, ServiceName = var.ecs_service_name }
  rds_dimensions = { DBInstanceIdentifier = var.db_instance_identifier }

  alarms = {
    alb-5xx = {
      description = "The load balancer itself is returning 5xx (no healthy target, or timeouts)."
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_ELB_5XX_Count"
      statistic   = "Sum"
      comparison  = "GreaterThanThreshold"
      threshold   = var.http_5xx_threshold
      period      = 300
      periods     = 1
      missing     = "notBreaching"
      dimensions  = local.alb_dimensions
    }
    api-5xx = {
      description = "The API is answering with 5xx."
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_Target_5XX_Count"
      statistic   = "Sum"
      comparison  = "GreaterThanThreshold"
      threshold   = var.http_5xx_threshold
      period      = 300
      periods     = 1
      missing     = "notBreaching"
      dimensions  = local.alb_dimensions
    }
    api-unhealthy-targets = {
      description = "At least one API task is failing its readiness check."
      namespace   = "AWS/ApplicationELB"
      metric      = "UnHealthyHostCount"
      statistic   = "Maximum"
      comparison  = "GreaterThanThreshold"
      threshold   = 0
      period      = 60
      periods     = 3
      missing     = "notBreaching"
      dimensions  = merge(local.alb_dimensions, { TargetGroup = var.target_group_arn_suffix })
    }
    api-cpu-high = {
      description = "API tasks are CPU-bound; autoscaling may be at its ceiling."
      namespace   = "AWS/ECS"
      metric      = "CPUUtilization"
      statistic   = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 85
      period      = 300
      periods     = 3
      missing     = "missing"
      dimensions  = local.ecs_dimensions
    }
    api-memory-high = {
      description = "API tasks are close to their memory limit."
      namespace   = "AWS/ECS"
      metric      = "MemoryUtilization"
      statistic   = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 85
      period      = 300
      periods     = 3
      missing     = "missing"
      dimensions  = local.ecs_dimensions
    }
    db-cpu-high = {
      description = "PostgreSQL CPU is sustained high."
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      statistic   = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 80
      period      = 300
      periods     = 3
      missing     = "missing"
      dimensions  = local.rds_dimensions
    }
    db-storage-low = {
      description = "PostgreSQL free storage is running out."
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      statistic   = "Minimum"
      comparison  = "LessThanThreshold"
      threshold   = var.db_free_storage_threshold_gb * 1024 * 1024 * 1024
      period      = 300
      periods     = 1
      missing     = "missing"
      dimensions  = local.rds_dimensions
    }
    db-connections-high = {
      description = "PostgreSQL connections are near the instance limit."
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      statistic   = "Maximum"
      comparison  = "GreaterThanThreshold"
      threshold   = var.db_connections_threshold
      period      = 300
      periods     = 2
      missing     = "missing"
      dimensions  = local.rds_dimensions
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = local.alarms

  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  comparison_operator = each.value.comparison
  threshold           = each.value.threshold
  period              = each.value.period
  evaluation_periods  = each.value.periods
  treat_missing_data  = each.value.missing
  dimensions          = each.value.dimensions

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
