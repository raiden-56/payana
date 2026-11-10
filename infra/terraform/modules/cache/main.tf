resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

# With in-transit encryption on, clients authenticate with this token.
# It is generated here, so it lives in Terraform state (keep the state bucket
# encrypted and restricted) and is handed to the API through Secrets Manager.
resource "random_password" "auth_token" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.name
  description          = "Payana cache, rate limiting and job coordination"

  engine               = var.engine
  engine_version       = var.engine_version
  parameter_group_name = var.parameter_group_name
  node_type            = var.node_type
  port                 = 6379

  num_cache_clusters         = var.node_count
  automatic_failover_enabled = var.node_count > 1
  multi_az_enabled           = var.node_count > 1

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.security_group_id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result

  snapshot_retention_limit   = var.snapshot_retention_days
  maintenance_window         = "sun:23:00-mon:00:00"
  auto_minor_version_upgrade = true
  apply_immediately          = var.apply_immediately

  tags = { Name = var.name }
}
