# AWS Terraform Scaffold

## Status

This directory is an incremental Terraform scaffold for a future AWS MVP
deployment of `transaction-event-gateway`. It currently defines the ECR
repository needed to store application images, the minimal security groups for
ALB, future ECS tasks, RDS PostgreSQL, and ElastiCache Redis resources, the MVP
HTTP Application Load Balancer path for the future API service, a private RDS
PostgreSQL instance, a private ElastiCache Redis replication group, and ECS
Fargate task definitions for the API, worker, and one-off migration runtime
units. It also includes the minimal ECS task execution role and CloudWatch log
groups needed by those task definitions. It is not ready for `apply` and does
not require AWS credentials for formatting or validation.

The current Terraform files are intended to support structure review,
formatting, and validation only. They should not be used to create, update, or
delete live infrastructure in this phase without explicit approval.

## Current contents

- `versions.tf`: Terraform and AWS provider version constraints.
- `providers.tf`: AWS provider configuration through variables only. No
  credentials are configured here.
- `variables.tf`: baseline inputs for region, naming, image reference,
  existing networking, HTTP allow-list, ports, health check path, and tags.
- `locals.tf`: shared naming and tag values for future resources.
- `main.tf`: phase overview and future resource group notes.
- `ecr.tf`: ECR repository, immutable tag policy, scan-on-push setting, AES256
  encryption, and a small image retention policy.
- `security-groups.tf`: security groups and explicit rules for the future ALB,
  ECS tasks, RDS PostgreSQL, and Redis network path.
- `alb.tf`: internet-facing ALB, HTTP target group, and HTTP listener for the
  future API service.
- `rds.tf`: private DB subnet group and RDS PostgreSQL instance.
- `redis.tf`: private ElastiCache Redis subnet group and replication group.
- `ecs-tasks.tf`: ECS Fargate task definitions for API, worker, and migration
  tasks, plus minimal task execution IAM and task log groups.
- `outputs.tf`: scaffold outputs plus ECR repository, security group IDs, and
  ALB, RDS, Redis, ECS task definition, and execution role values.
- `example.tfvars`: dummy values for local review. Do not put real secrets here.

## Planned AWS resource phases

The resource implementation should continue in small phases after review:

1. State backend design and environment layout.
2. Network path selection: existing VPC inputs first, optional managed VPC later.
3. ECS cluster, API service, worker service, and the one-off migration task run
   path.
4. HTTPS listener, ACM certificate, and optional production ALB hardening.
5. Secrets Manager or SSM Parameter Store wiring for runtime values, including
   wiring the RDS-managed PostgreSQL secret into `DATABASE_URL`.
6. Application task role permissions only if a later phase needs runtime AWS
   API access beyond ECS-managed image pulls and logs.
7. Release workflow design after explicit approval.

## Variables

| Variable | Purpose |
| --- | --- |
| `aws_region` | Target AWS region for future resources. |
| `project_name` | Short ECR-safe name used in future resource names and tags. Lowercase letters and digits with single hyphens between segments. |
| `environment` | Short ECR-safe environment name such as `dev`, `stage`, or `staging-1`. Lowercase letters and digits with single hyphens between segments. |
| `container_image` | Future ECS image reference. Use an immutable tag or digest later. |
| `api_task_cpu` | Fargate CPU units for the API task definition. |
| `api_task_memory` | Fargate memory in MiB for the API task definition. |
| `worker_task_cpu` | Fargate CPU units for the worker task definition. |
| `worker_task_memory` | Fargate memory in MiB for the worker task definition. |
| `migration_task_cpu` | Fargate CPU units for the one-off migration task definition. |
| `migration_task_memory` | Fargate memory in MiB for the one-off migration task definition. |
| `ecs_log_retention_days` | CloudWatch Logs retention for API, worker, and migration task log groups. |
| `app_environment_variables` | Non-secret environment variables injected into all ECS task definitions. Defaults to `NODE_ENV=production` and `PORT=3000`; do not place secrets here. |
| `create_vpc` | Future switch for managed VPC creation. Current scaffold does not create VPC resources. |
| `vpc_id` | Existing VPC ID for security groups. |
| `public_subnet_ids` | Public subnets intended for a future ALB. |
| `private_subnet_ids` | Private subnets intended for future ECS, RDS, Redis, and migration tasks. |
| `allowed_http_cidrs` | IPv4 CIDR blocks allowed to reach the future public ALB over HTTP. Defaults to `["0.0.0.0/0"]` as an MVP placeholder. |
| `app_port` | API container port. Defaults to `3000`. |
| `alb_port` | Future public ALB HTTP port. Defaults to `80`. |
| `alb_enable_deletion_protection` | ALB deletion protection switch. Defaults to `false` for this no-apply MVP scaffold. |
| `postgres_port` | PostgreSQL port for future RDS access. Defaults to `5432`. |
| `postgres_engine_version` | PostgreSQL engine version. Defaults to `16.6`. |
| `postgres_instance_class` | RDS PostgreSQL instance class. Defaults to `db.t4g.micro`. |
| `postgres_allocated_storage` | Initial PostgreSQL storage in GiB. Defaults to `20`. |
| `postgres_max_allocated_storage` | Maximum autoscaled PostgreSQL storage in GiB. Defaults to `100`. |
| `postgres_db_name` | Initial PostgreSQL database name. Defaults to `transaction_event_gateway`. |
| `postgres_username` | PostgreSQL master username. The password is managed by RDS and is not stored in Terraform files. |
| `postgres_backup_retention_days` | Automated backup retention in days. Defaults to `7`. |
| `postgres_multi_az` | Multi-AZ switch for PostgreSQL. Defaults to `false` for this no-apply MVP scaffold. |
| `postgres_deletion_protection` | RDS deletion protection switch. Defaults to `false` for this no-apply MVP scaffold. |
| `postgres_skip_final_snapshot` | RDS final snapshot skip switch. Defaults to `true` for this no-apply MVP scaffold; production should usually set this to `false`. |
| `redis_port` | Redis port for ElastiCache access. Defaults to `6379`. |
| `redis_node_type` | ElastiCache Redis node type. Defaults to `cache.t4g.micro` for scaffold review. |
| `redis_engine_version` | Redis engine version. Defaults to `7.1`. |
| `redis_num_cache_clusters` | Number of Redis cache clusters in the replication group. Defaults to `1`; use at least `2` with automatic failover. |
| `redis_automatic_failover_enabled` | Redis automatic failover switch. Defaults to `false` for this no-apply MVP scaffold. |
| `redis_multi_az_enabled` | Redis Multi-AZ switch. Defaults to `false`; requires automatic failover when enabled. |
| `redis_at_rest_encryption_enabled` | Redis at-rest encryption switch. Defaults to `true`. |
| `redis_transit_encryption_enabled` | Redis in-transit encryption switch. Defaults to `false` because current app config validates `redis://` URLs only. |
| `redis_snapshot_retention_limit` | Redis automatic snapshot retention in days. Defaults to `7`; use `0` to disable snapshots. |
| `redis_apply_immediately` | Whether Redis changes should apply immediately. Defaults to `false` so reviewed changes can wait for the next maintenance window. |
| `health_check_path` | Future ALB health check path. Defaults to `/health/ready`. |
| `tags` | Additional non-secret tags for future AWS resources. |

## Current resource scope

This phase defines only ECR, security group, ALB, RDS PostgreSQL, ElastiCache
Redis, ECS task definition, minimal ECS task execution IAM, and ECS task log
group resources:

- `aws_ecr_repository.app`: application image repository named from
  `local.name_prefix`, with immutable image tags, scan on push, and AES256
  encryption.
- `aws_ecr_lifecycle_policy.app`: retention policy that keeps the most recent
  30 images.
- `aws_security_group.alb`: security group intended for the future public ALB.
- `aws_security_group.ecs_tasks`: security group intended for future ECS API and
  worker tasks.
- `aws_security_group.rds`: security group intended for future RDS PostgreSQL.
- `aws_security_group.redis`: security group intended for future ElastiCache
  Redis.
- `aws_vpc_security_group_ingress_rule.alb_http`: allows HTTP on `alb_port`
  from `allowed_http_cidrs`.
- `aws_vpc_security_group_egress_rule.alb_to_ecs_tasks`: allows the ALB to reach
  ECS tasks on `app_port`.
- `aws_vpc_security_group_ingress_rule.ecs_tasks_from_alb`: allows ECS tasks to
  receive `app_port` traffic only from the ALB security group.
- `aws_vpc_security_group_egress_rule.ecs_tasks_to_postgres`: allows ECS tasks
  to reach PostgreSQL on `postgres_port`.
- `aws_vpc_security_group_egress_rule.ecs_tasks_to_redis`: allows ECS tasks to
  reach Redis on `redis_port`.
- `aws_vpc_security_group_egress_rule.ecs_tasks_to_https`: allows explicit HTTPS
  egress for required AWS service endpoints through the future private network
  path.
- `aws_vpc_security_group_ingress_rule.rds_from_ecs_tasks`: allows PostgreSQL
  from the ECS tasks security group only.
- `aws_vpc_security_group_ingress_rule.redis_from_ecs_tasks`: allows Redis from
  the ECS tasks security group only.
- `aws_lb.api`: internet-facing Application Load Balancer in
  `public_subnet_ids`, using the ALB security group.
- `aws_lb_target_group.api`: HTTP target group on `app_port` with
  `target_type = "ip"` for future ECS Fargate API tasks and `/health/ready`
  health checks.
- `aws_lb_listener.http`: MVP HTTP listener on `alb_port` that forwards to the
  future API target group. Until a future ECS service registers targets, the
  listener can return no-target responses from the empty target group.
- `aws_db_subnet_group.postgres`: DB subnet group built only from
  `private_subnet_ids`.
- `aws_db_instance.postgres`: private RDS PostgreSQL instance using
  `aws_security_group.rds.id`, encrypted `gp3` storage, automated backups, and
  an AWS-managed master user password.
- `aws_elasticache_subnet_group.redis`: Redis subnet group built only from
  `private_subnet_ids`.
- `aws_elasticache_replication_group.redis`: private Redis replication group
  using `aws_security_group.redis.id`, at-rest encryption, automatic snapshots,
  and configurable failover, Multi-AZ, node sizing, and transit encryption.
- `aws_cloudwatch_log_group.api`: log group for future API task logs.
- `aws_cloudwatch_log_group.worker`: log group for future worker task logs.
- `aws_cloudwatch_log_group.migration`: log group for future one-off migration
  task logs.
- `aws_iam_role.ecs_task_execution`: ECS task execution role trusted only by
  `ecs-tasks.amazonaws.com`.
- `aws_iam_role_policy.ecs_task_execution`: minimal execution permissions for
  pulling from the app ECR repository, authorizing ECR image pulls, and writing
  streams/events to the task log groups.
- `aws_ecs_task_definition.api`: Fargate API task definition using
  `var.container_image`, `node dist/main.js`, the configured `app_port`, and
  the API log group.
- `aws_ecs_task_definition.worker`: Fargate worker task definition using
  `var.container_image`, `node dist/worker.js`, and the worker log group.
- `aws_ecs_task_definition.migration`: Fargate one-off migration task
  definition using `var.container_image`, `npm run migration:run`, and the
  migration log group.

The migration task definition follows the existing package script. Before a
real one-off ECS migration run is enabled, a later Docker or migration-runtime
phase must verify that the production image includes runnable migration
artifacts and dependencies.

The target group health check uses `/health/ready`. That endpoint checks
required app configuration, PostgreSQL, and Redis readiness. This intentionally
favors removing API tasks from ALB rotation when async processing dependencies
are unhealthy, but it also means Redis incidents can remove API tasks even
though some durable PostgreSQL-backed writes may still work. See
`docs/aws-deployment-design.md` for the deployment trade-off.

The RDS instance sets `publicly_accessible = false` and uses the private DB
subnet group. It is reachable only through the existing RDS security group rule
that allows PostgreSQL from the ECS tasks security group. The ECS task
definitions do not receive `DATABASE_URL`; a later ECS/secrets phase must read
the RDS-managed secret and assemble the runtime connection string.

RDS uses `manage_master_user_password = true`, so Terraform does not take or
store a plaintext database password. The AWS-managed master user secret ARN is
exposed as a sensitive output for later wiring.

The Redis replication group uses a private ElastiCache subnet group built from
`private_subnet_ids` and is attached only to `aws_security_group.redis.id`.
Redis is not public and is reachable only from future ECS tasks through the
existing Redis security group rule. Redis backs BullMQ queue infrastructure; it
is not the source of truth for accepted webhook work or payment state.

Redis at-rest encryption defaults to enabled. Redis in-transit encryption
defaults to disabled in this slice because the current application validation
accepts only `redis://` URLs. A production move to Redis TLS should first update
client configuration and runtime validation for `rediss://`, then enable
`redis_transit_encryption_enabled` during a reviewed infrastructure change.

The ECS task definitions do not receive `REDIS_URL`; a later ECS/secrets phase
must build the runtime connection string from the Redis primary endpoint and
port.

The ECS task definitions intentionally include only non-secret environment
variables through `app_environment_variables`. Do not put `DATABASE_URL`,
`REDIS_URL`, `WEBHOOK_SECRET`, AWS credentials, account IDs, real ARNs, or other
secret values in Terraform or tfvars files. Because secrets are not wired yet,
the task definitions are registration scaffolding, not a complete runnable
deployment.

No application task role is defined in this phase because the application does
not receive runtime AWS API permissions yet. Add an app task role only when a
later secrets or AWS-integration phase needs scoped runtime permissions.

No VPC, subnet, route table, NAT gateway, ECS cluster, ECS service, autoscaling,
standalone Secrets Manager resource, deployment workflow, registry login, or
image push behavior is implemented in this phase.

Existing VPC and subnet IDs are variables only. This scaffold does not use
Terraform data sources or modules.

The ALB listener is HTTP-only for this MVP scaffold. HTTPS, ACM certificate
wiring, redirects, WAF, and other production hardening belong to later phases
after explicit review.

Do not store AWS credentials, account IDs, secret values, real ARNs, database
passwords, database URLs, Redis URLs, or webhook secrets in Terraform files or
tfvars files.

Before production use, review RDS deletion protection, backup retention, final
snapshot behavior, Multi-AZ, storage sizing, maintenance settings, and the
database migration strategy. Also review Redis transit encryption and client
configuration, automatic snapshots, failover, Multi-AZ, and node sizing. The
scaffold defaults favor no-apply review, not production durability.

## State backend plan

No remote backend is configured yet. During this scaffold phase, validation
should use `init -backend=false` and should not create Terraform state.

A later phase should add an S3 backend with locking after the AWS account,
region, bucket naming, encryption policy, and access model are approved. The
future backend shape should be documented before use, for example:

```hcl
terraform {
  backend "s3" {
    bucket         = "example-terraform-state-bucket"
    key            = "transaction-event-gateway/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "example-terraform-locks"
  }
}
```

The values above are placeholders only.

## Safe validation commands

These commands are allowed for scaffold review:

```bash
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

`init -backend=false` may download the Terraform provider from the Terraform
registry, but it should not contact AWS APIs and should not require AWS
credentials.

## Commands requiring explicit approval

Do not run these commands for this phase without explicit approval:

```bash
terraform -chdir=infra/terraform plan
terraform -chdir=infra/terraform apply
terraform -chdir=infra/terraform destroy
terraform -chdir=infra/terraform import
aws ecr get-login-password
docker push
```

Also do not add deployment workflows, push images to ECR, create AWS resources,
or add credentials or secret values.
