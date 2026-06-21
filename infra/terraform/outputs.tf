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

# Future phases can add concrete outputs for ECR, ALB, ECS, RDS, and Redis IDs
# only after those resources are implemented.
