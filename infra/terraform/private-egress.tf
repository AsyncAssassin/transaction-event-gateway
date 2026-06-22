locals {
  private_egress_interface_endpoints = {
    cloudwatch_logs = {
      name         = "${local.name_prefix}-logs"
      service_name = "com.amazonaws.${var.aws_region}.logs"
    }
    ecr_api = {
      name         = "${local.name_prefix}-ecr-api"
      service_name = "com.amazonaws.${var.aws_region}.ecr.api"
    }
    ecr_docker = {
      name         = "${local.name_prefix}-ecr-dkr"
      service_name = "com.amazonaws.${var.aws_region}.ecr.dkr"
    }
    secretsmanager = {
      name         = "${local.name_prefix}-secretsmanager"
      service_name = "com.amazonaws.${var.aws_region}.secretsmanager"
    }
  }
}

resource "aws_vpc_endpoint" "s3" {
  count = var.create_private_egress_endpoints ? 1 : 0

  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.private_route_table_ids

  tags = {
    Name = "${local.name_prefix}-s3-gateway"
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = var.create_private_egress_endpoints ? local.private_egress_interface_endpoints : {}

  vpc_id              = var.vpc_id
  service_name        = each.value.service_name
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.private_subnet_ids
  security_group_ids  = [aws_security_group.private_egress_endpoints[0].id]
  private_dns_enabled = true

  tags = {
    Name = each.value.name
  }
}
