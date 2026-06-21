resource "aws_elasticache_subnet_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "Private subnet group for the Redis ElastiCache replication group."
  subnet_ids  = var.private_subnet_ids

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name_prefix}-redis"
  description          = "Private Redis replication group for BullMQ queue infrastructure."

  engine         = "redis"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = var.redis_port

  num_cache_clusters         = var.redis_num_cache_clusters
  automatic_failover_enabled = var.redis_automatic_failover_enabled
  multi_az_enabled           = var.redis_multi_az_enabled

  at_rest_encryption_enabled = var.redis_at_rest_encryption_enabled
  transit_encryption_enabled = var.redis_transit_encryption_enabled
  snapshot_retention_limit   = var.redis_snapshot_retention_limit

  apply_immediately          = var.redis_apply_immediately
  auto_minor_version_upgrade = true
  security_group_ids         = [aws_security_group.redis.id]
  subnet_group_name          = aws_elasticache_subnet_group.redis.name

  lifecycle {
    precondition {
      condition     = !var.redis_automatic_failover_enabled || var.redis_num_cache_clusters >= 2
      error_message = "redis_num_cache_clusters must be at least 2 when redis_automatic_failover_enabled is true."
    }

    precondition {
      condition     = !var.redis_multi_az_enabled || var.redis_automatic_failover_enabled
      error_message = "redis_automatic_failover_enabled must be true when redis_multi_az_enabled is true."
    }
  }

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}
