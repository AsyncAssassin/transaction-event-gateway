output "name_prefix" {
  description = "Name prefix planned for future AWS resources."
  value       = local.name_prefix
}

output "aws_region" {
  description = "AWS region selected for future deployment work."
  value       = var.aws_region
}

output "networking_mode" {
  description = "Current scaffold networking path."
  value       = local.networking_mode
}

output "ecr_repository_name" {
  description = "Name of the ECR repository for application images."
  value       = aws_ecr_repository.app.name
}

output "ecr_repository_url" {
  description = "Repository URL for pushing application images after an approved deployment phase."
  value       = aws_ecr_repository.app.repository_url
}

output "ecr_repository_arn" {
  description = "ARN of the ECR repository for application images."
  value       = aws_ecr_repository.app.arn
}

output "alb_security_group_id" {
  description = "ID of the security group intended for the future public ALB."
  value       = aws_security_group.alb.id
}

output "ecs_tasks_security_group_id" {
  description = "ID of the security group intended for future ECS API and worker tasks."
  value       = aws_security_group.ecs_tasks.id
}

output "rds_security_group_id" {
  description = "ID of the security group intended for the future RDS PostgreSQL instance."
  value       = aws_security_group.rds.id
}

output "postgres_endpoint" {
  description = "Connection endpoint for the private PostgreSQL RDS instance."
  value       = aws_db_instance.postgres.endpoint
}

output "postgres_port" {
  description = "Port for the private PostgreSQL RDS instance."
  value       = aws_db_instance.postgres.port
}

output "postgres_database_name" {
  description = "Initial database name configured for PostgreSQL."
  value       = aws_db_instance.postgres.db_name
}

output "postgres_instance_id" {
  description = "Identifier of the PostgreSQL RDS instance."
  value       = aws_db_instance.postgres.id
}

output "postgres_master_user_secret_arn" {
  description = "ARN of the AWS-managed RDS master user secret."
  value       = try(aws_db_instance.postgres.master_user_secret[0].secret_arn, null)
  sensitive   = true
}

output "redis_security_group_id" {
  description = "ID of the security group intended for the ElastiCache Redis replication group."
  value       = aws_security_group.redis.id
}

output "redis_primary_endpoint_address" {
  description = "Primary endpoint address for the private Redis ElastiCache replication group."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  description = "Port for the private Redis ElastiCache replication group."
  value       = var.redis_port
}

output "redis_replication_group_id" {
  description = "Identifier of the Redis ElastiCache replication group."
  value       = aws_elasticache_replication_group.redis.id
}

output "alb_dns_name" {
  description = "DNS name of the future public API Application Load Balancer."
  value       = aws_lb.api.dns_name
}

output "alb_arn" {
  description = "ARN of the future public API Application Load Balancer."
  value       = aws_lb.api.arn
}

output "alb_target_group_arn" {
  description = "ARN of the HTTP target group intended for future ECS API tasks."
  value       = aws_lb_target_group.api.arn
}

output "alb_listener_arn" {
  description = "ARN of the MVP HTTP listener for the future API ALB."
  value       = aws_lb_listener.http.arn
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster for API and worker services."
  value       = aws_ecs_cluster.main.name
}

output "api_service_name" {
  description = "Name of the ECS API service attached to the ALB target group."
  value       = aws_ecs_service.api.name
}

output "worker_service_name" {
  description = "Name of the ECS worker service without load balancer attachment."
  value       = aws_ecs_service.worker.name
}

output "api_task_definition_arn" {
  description = "ARN of the ECS Fargate API task definition."
  value       = aws_ecs_task_definition.api.arn
}

output "worker_task_definition_arn" {
  description = "ARN of the ECS Fargate worker task definition."
  value       = aws_ecs_task_definition.worker.arn
}

output "migration_task_definition_arn" {
  description = "ARN of the ECS Fargate one-off migration task definition."
  value       = aws_ecs_task_definition.migration.arn
}

output "execution_role_arn" {
  description = "ARN of the ECS task execution role used for image pulls and task logs."
  value       = aws_iam_role.ecs_task_execution.arn
}
