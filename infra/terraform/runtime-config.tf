resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name_prefix}/runtime/database-url"
  description             = "Complete PostgreSQL DATABASE_URL for ECS tasks. Populate only after approval; Terraform does not store the value."
  recovery_window_in_days = 7

  tags = {
    Name = "${local.name_prefix}-database-url"
  }
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${local.name_prefix}/runtime/redis-url"
  description             = "Complete redis:// REDIS_URL for ECS tasks. Populate only after approval; Terraform does not store the value."
  recovery_window_in_days = 7

  tags = {
    Name = "${local.name_prefix}-redis-url"
  }
}

resource "aws_secretsmanager_secret" "webhook_secret" {
  name                    = "${local.name_prefix}/runtime/webhook-secret"
  description             = "Webhook HMAC secret for ECS tasks. Populate only after approval; Terraform does not store the value."
  recovery_window_in_days = 7

  tags = {
    Name = "${local.name_prefix}-webhook-secret"
  }
}
