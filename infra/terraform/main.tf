# Resources are grouped by concern: ECR, security groups, ALB, private RDS
# PostgreSQL, private ElastiCache Redis, runtime secret placeholders, ECS task
# definitions, ECS cluster and services, and private VPC endpoint egress.
# Not defined yet:
# - A way to run the one-off migration task before the services roll out.
# - HTTPS listener, certificate wiring, and production ALB hardening.
# - Secret value population and rotation.
