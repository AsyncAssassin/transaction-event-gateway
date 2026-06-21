locals {
  ecs_app_environment = [
    for name in sort(keys(var.app_environment_variables)) : {
      name  = name
      value = var.app_environment_variables[name]
    }
  ]

  ecs_task_log_group_arns = [
    aws_cloudwatch_log_group.api.arn,
    aws_cloudwatch_log_group.worker.arn,
    aws_cloudwatch_log_group.migration.arn,
  ]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}/api"
  retention_in_days = var.ecs_log_retention_days

  tags = {
    Name = "${local.name_prefix}-api"
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name_prefix}/worker"
  retention_in_days = var.ecs_log_retention_days

  tags = {
    Name = "${local.name_prefix}-worker"
  }
}

resource "aws_cloudwatch_log_group" "migration" {
  name              = "/ecs/${local.name_prefix}/migration"
  retention_in_days = var.ecs_log_retention_days

  tags = {
    Name = "${local.name_prefix}-migration"
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-ecs-exec"
  }
}

resource "aws_iam_role_policy" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-exec"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid = "AuthorizeEcrImagePull"
        Action = [
          "ecr:GetAuthorizationToken",
        ]
        Effect   = "Allow"
        Resource = "*"
      },
      {
        Sid = "PullAppImage"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Effect   = "Allow"
        Resource = aws_ecr_repository.app.arn
      },
      {
        Sid = "WriteTaskLogs"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Effect = "Allow"
        Resource = [
          for log_group_arn in local.ecs_task_log_group_arns : "${log_group_arn}:*"
        ]
      }
    ]
  })
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_task_cpu)
  memory                   = tostring(var.api_task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([
    {
      name        = "api"
      image       = var.container_image
      essential   = true
      command     = ["node", "dist/main.js"]
      environment = local.ecs_app_environment
      portMappings = [
        {
          containerPort = var.app_port
          hostPort      = var.app_port
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])

  tags = {
    Name = "${local.name_prefix}-api"
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.worker_task_cpu)
  memory                   = tostring(var.worker_task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([
    {
      name        = "worker"
      image       = var.container_image
      essential   = true
      command     = ["node", "dist/worker.js"]
      environment = local.ecs_app_environment
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])

  tags = {
    Name = "${local.name_prefix}-worker"
  }
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${local.name_prefix}-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.migration_task_cpu)
  memory                   = tostring(var.migration_task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([
    {
      name        = "migration"
      image       = var.container_image
      essential   = true
      command     = ["npm", "run", "migration:run:prod"]
      environment = local.ecs_app_environment
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.migration.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "migration"
        }
      }
    }
  ])

  tags = {
    Name = "${local.name_prefix}-migration"
  }
}
