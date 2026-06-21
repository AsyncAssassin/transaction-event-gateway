resource "aws_db_subnet_group" "postgres" {
  name        = "${local.name_prefix}-postgres"
  description = "Private subnet group for the PostgreSQL RDS instance."
  subnet_ids  = var.private_subnet_ids

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.postgres_instance_class

  allocated_storage     = var.postgres_allocated_storage
  max_allocated_storage = var.postgres_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.postgres_db_name
  username = var.postgres_username

  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  port                   = var.postgres_port

  backup_retention_period = var.postgres_backup_retention_days
  copy_tags_to_snapshot   = true
  deletion_protection     = var.postgres_deletion_protection
  final_snapshot_identifier = (
    "${local.name_prefix}-postgres-final-snapshot"
  )
  multi_az            = var.postgres_multi_az
  skip_final_snapshot = var.postgres_skip_final_snapshot

  apply_immediately          = false
  auto_minor_version_upgrade = true

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}
