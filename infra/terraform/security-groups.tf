resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Controls public HTTP access to the future ALB."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name_prefix}-ecs-tasks"
  description = "Controls network access for future ECS API and worker tasks."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-ecs-tasks"
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Controls PostgreSQL access for the future RDS instance."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-rds"
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "Controls Redis access for the future ElastiCache cluster."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

resource "aws_security_group" "private_egress_endpoints" {
  count = var.create_private_egress_endpoints ? 1 : 0

  name        = "${local.name_prefix}-private-egress-vpce"
  description = "Controls HTTPS access to private VPC interface endpoints."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-private-egress-vpce"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = toset(var.allowed_http_cidrs)

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = var.alb_port
  to_port           = var.alb_port
  ip_protocol       = "tcp"
  description       = "Allow HTTP access to the future public ALB."
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs_tasks" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.ecs_tasks.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
  description                  = "Allow the future ALB to reach ECS tasks on the app port."
}

resource "aws_vpc_security_group_ingress_rule" "ecs_tasks_from_alb" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
  description                  = "Allow future ECS tasks to receive app traffic from the ALB."
}

resource "aws_vpc_security_group_egress_rule" "ecs_tasks_to_postgres" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = var.postgres_port
  to_port                      = var.postgres_port
  ip_protocol                  = "tcp"
  description                  = "Allow future ECS tasks to reach PostgreSQL."
}

resource "aws_vpc_security_group_egress_rule" "ecs_tasks_to_redis" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = var.redis_port
  to_port                      = var.redis_port
  ip_protocol                  = "tcp"
  description                  = "Allow future ECS tasks to reach Redis."
}

resource "aws_vpc_security_group_egress_rule" "ecs_tasks_to_private_egress_endpoints" {
  count = var.create_private_egress_endpoints ? 1 : 0

  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = aws_security_group.private_egress_endpoints[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "Allow ECS tasks to reach private VPC interface endpoints over HTTPS."
}

resource "aws_vpc_security_group_ingress_rule" "private_egress_endpoints_from_ecs_tasks" {
  count = var.create_private_egress_endpoints ? 1 : 0

  security_group_id            = aws_security_group.private_egress_endpoints[0].id
  referenced_security_group_id = aws_security_group.ecs_tasks.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "Allow HTTPS from ECS tasks to private VPC interface endpoints."
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs_tasks" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs_tasks.id
  from_port                    = var.postgres_port
  to_port                      = var.postgres_port
  ip_protocol                  = "tcp"
  description                  = "Allow PostgreSQL from future ECS tasks."
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_ecs_tasks" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.ecs_tasks.id
  from_port                    = var.redis_port
  to_port                      = var.redis_port
  ip_protocol                  = "tcp"
  description                  = "Allow Redis from future ECS tasks."
}
