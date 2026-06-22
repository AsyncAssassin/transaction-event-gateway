# Resource groups are added in small, reviewable phase-specific files.
#
# Current phase-specific files include ECR, security groups, ALB, private RDS
# PostgreSQL, private ElastiCache Redis, runtime secret placeholders, ECS task
# definitions, ECS cluster/service resources, and private VPC endpoint egress
# scaffolding. Future phases should add:
# - One-off migration task run path.
# - HTTPS listener, certificate wiring, and production ALB hardening.
# - Approved secret value population and rotation workflow.
