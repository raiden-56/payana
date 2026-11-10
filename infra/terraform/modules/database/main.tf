resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids

  tags = { Name = var.name }
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name}-pg17-"
  family      = "postgres17"
  description = "Payana PostgreSQL 17 parameters"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# PostGIS is not a parameter: it is enabled once per database with
# CREATE EXTENSION (see the db-bootstrap task in modules/api_service).
resource "aws_db_instance" "this" {
  identifier = var.name

  engine                     = "postgres"
  engine_version             = var.engine_version
  auto_minor_version_upgrade = true
  instance_class             = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.master_username
  # RDS generates the master password and keeps it in Secrets Manager.
  # It never appears in Terraform state or variables.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false
  multi_az               = var.multi_az
  parameter_group_name   = aws_db_parameter_group.this.name

  # Automated backups also enable point-in-time recovery for the retention window.
  backup_retention_period  = var.backup_retention_days
  backup_window            = "20:30-21:30"         # 02:00-03:00 IST
  maintenance_window       = "sun:22:00-sun:23:00" # Monday 03:30-04:30 IST
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name}-final"

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  apply_immediately               = var.apply_immediately

  tags = { Name = var.name }
}
