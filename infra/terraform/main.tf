# Resource groups are added in small, reviewable phase-specific files.
#
# Current phase-specific files include ECR, security groups, ALB, private RDS
# PostgreSQL, and private ElastiCache Redis resources. Future phases should add:
# - ECS cluster, API service, worker service, and migration task definition.
# - HTTPS listener, certificate wiring, and production ALB hardening.
# - IAM roles, CloudWatch logs, and Secrets Manager or SSM wiring.
