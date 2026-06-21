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

# Future phases can add concrete outputs for ALB, ECS, RDS, and Redis IDs
# only after those resources are implemented.
