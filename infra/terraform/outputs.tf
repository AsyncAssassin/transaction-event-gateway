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

output "redis_security_group_id" {
  description = "ID of the security group intended for the future ElastiCache Redis cluster."
  value       = aws_security_group.redis.id
}
