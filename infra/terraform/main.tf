# Resource groups are added in small, reviewable phase-specific files.
#
# Current phase-specific files include ECR, security groups, ALB, and private
# RDS PostgreSQL resources. Future phases should add:
# - ECS cluster, API service, worker service, and migration task definition.
# - HTTPS listener, certificate wiring, and production ALB hardening.
# - ElastiCache Redis in private networking.
# - IAM roles, CloudWatch logs, and Secrets Manager or SSM wiring.
