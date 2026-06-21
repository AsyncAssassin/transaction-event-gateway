# Resource groups are added in small, reviewable phase-specific files.
#
# Current phase-specific files include ECR, security groups, ALB, private RDS
# PostgreSQL, private ElastiCache Redis, ECS task definitions, and ECS cluster
# and service resources. Future phases should add:
# - One-off migration task run path.
# - HTTPS listener, certificate wiring, and production ALB hardening.
# - Application task roles and Secrets Manager or SSM wiring.
