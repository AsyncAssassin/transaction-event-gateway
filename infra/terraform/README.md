# AWS Terraform Scaffold

## Status

This directory is an incremental Terraform scaffold for a future AWS MVP
deployment of `transaction-event-gateway`. It currently defines the ECR
repository needed to store application images, the minimal security groups for
ALB, ECS tasks, RDS PostgreSQL, and ElastiCache Redis resources, the MVP HTTP
Application Load Balancer path for the API service, a private RDS PostgreSQL
instance, a private ElastiCache Redis replication group, ECS Fargate task
definitions for the API, worker, and one-off migration runtime units, and ECS
cluster/API/worker service resources. It also includes the minimal ECS task
execution role, CloudWatch log groups, and Secrets Manager placeholders needed
by those task definitions, plus a configurable private VPC endpoint egress path
for ECR image pulls, CloudWatch Logs, Secrets Manager runtime secrets, and
S3-backed ECR layer access. The Terraform backend/state decision is documented,
but no remote backend is configured or enabled. It is not ready for `apply` and
does not require AWS credentials for formatting or validation.

The ECR image publishing path is documented in
[`../../docs/ecr-image-publishing.md`](../../docs/ecr-image-publishing.md), but
it has not been executed. No image has been published, no registry
authentication is configured, and no deploy workflow exists in this scaffold.
Current CI only verifies the Docker image locally.

The one-off ECS migration task flow is documented in
[`../../docs/aws-migration-task-flow.md`](../../docs/aws-migration-task-flow.md),
but it has not been executed. The migration task definition exists; no task
runner, deploy workflow, or live AWS run is added by this scaffold.

The deployed smoke test flow is documented in
[`../../docs/aws-smoke-test-flow.md`](../../docs/aws-smoke-test-flow.md), but it
has not been executed. No deployed API base URL is provided by this scaffold,
and no live smoke run is approved in this phase.

The short-lived deploy runbook is documented in
[`../../docs/aws-short-lived-deploy-runbook.md`](../../docs/aws-short-lived-deploy-runbook.md),
but it has not been executed. It connects the guardrails, backend/state owner,
private egress inputs, secret population, image approval, migration gate,
API/worker rollout gate, deployed smoke gate, monitoring window, and teardown
decision for a future approval-gated AWS run.

The current Terraform files are intended to support structure review,
formatting, and validation only. They should not be used to create, update, or
delete live infrastructure in this phase without explicit approval.

## Current contents

- `versions.tf`: Terraform and AWS provider version constraints.
- `providers.tf`: AWS provider configuration through variables only. No
  credentials are configured here.
- `backend.hcl.example`: placeholder-only S3 backend config template for a
  future approved remote backend. Copy values into ignored `backend.hcl` only
  after backend ownership and environment values are approved.
- `variables.tf`: baseline inputs for region, naming, image reference,
  existing networking, HTTP allow-list, ports, health check path, and tags.
- `locals.tf`: shared naming and tag values for future resources.
- `main.tf`: phase overview and future resource group notes.
- `ecr.tf`: ECR repository, immutable tag policy, scan-on-push setting, AES256
  encryption, and a small image retention policy.
- `runtime-config.tf`: Secrets Manager secret metadata for runtime values.
  It intentionally creates no secret versions or plaintext values.
- `security-groups.tf`: security groups and explicit rules for the future ALB,
  ECS tasks, private interface endpoints, RDS PostgreSQL, and Redis network
  path.
- `private-egress.tf`: preferred private VPC endpoint path for ECR API, ECR
  Docker, CloudWatch Logs, Secrets Manager, and S3-backed ECR layer access.
- `alb.tf`: internet-facing ALB, HTTP target group, and HTTP listener for the
  API service.
- `rds.tf`: private DB subnet group and RDS PostgreSQL instance.
- `redis.tf`: private ElastiCache Redis subnet group and replication group.
- `ecs-tasks.tf`: ECS Fargate task definitions for API, worker, and migration
  tasks, plus minimal task execution IAM and task log groups.
- `ecs-services.tf`: ECS cluster plus Fargate API and worker services. The API
  service is attached to the ALB target group; the worker has no load balancer.
- `outputs.tf`: scaffold outputs plus ECR repository, security group IDs, VPC
  endpoint IDs, and ALB, RDS, Redis, ECS cluster/service, ECS task definition,
  and execution role values.
- `example.tfvars`: dummy values for local review. Do not put real secrets here.

## Planned AWS resource phases

The resource implementation should continue in small phases after review:

1. Environment layout and approved backend config before the first remote
   backend init or apply.
2. Approved VPC, subnet, and private route table input review for a real
   endpoint apply; optional managed VPC can be revisited later.
3. Approved ECR image publishing and `container_image` selection.
4. Review the documented one-off migration task flow before any approved live
   run.
5. Review the documented deployed smoke test flow before any approved smoke run
   against a deployed API base URL.
6. Review the short-lived deploy runbook before any first short-lived AWS
   deploy attempt.
7. HTTPS listener, ACM certificate, and optional production ALB hardening.
8. Approved runtime secret value population, including assembling
   `DATABASE_URL` from the RDS endpoint and RDS-managed PostgreSQL secret
   outside git.
9. Application task role permissions only if a later phase needs runtime AWS
   API access beyond ECS-managed image pulls and logs.
10. Release workflow design after explicit approval.

## Variables

| Variable | Purpose |
| --- | --- |
| `aws_region` | Target AWS region for future resources. |
| `project_name` | Short ECR-safe name used in future resource names and tags. Lowercase letters and digits with single hyphens between segments. |
| `environment` | Short ECR-safe environment name such as `dev`, `stage`, or `staging-1`. Lowercase letters and digits with single hyphens between segments. |
| `container_image` | Future ECS image reference. Use only an approved immutable tag or digest in real environments; never use `latest`. |
| `api_task_cpu` | Fargate CPU units for the API task definition. |
| `api_task_memory` | Fargate memory in MiB for the API task definition. |
| `worker_task_cpu` | Fargate CPU units for the worker task definition. |
| `worker_task_memory` | Fargate memory in MiB for the worker task definition. |
| `migration_task_cpu` | Fargate CPU units for the one-off migration task definition. |
| `migration_task_memory` | Fargate memory in MiB for the one-off migration task definition. |
| `api_desired_count` | Desired number of API ECS service tasks. Defaults to `1` for scaffold review. |
| `worker_desired_count` | Desired number of worker ECS service tasks. Defaults to `1` for scaffold review. |
| `ecs_log_retention_days` | CloudWatch Logs retention for API, worker, and migration task log groups. |
| `app_environment_variables` | Additional or overriding non-secret environment variables injected into all ECS task definitions. Base defaults include `NODE_ENV=production`, `PORT=3000`, `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300`, `OUTBOX_DISPATCH_ENABLED=true`, and `OUTBOX_DISPATCH_INTERVAL_MS=1000`; do not place secrets here. |
| `create_vpc` | Future switch for managed VPC creation. Current scaffold does not create VPC resources. |
| `vpc_id` | Existing VPC ID for security groups. |
| `public_subnet_ids` | Public subnets intended for a future ALB. |
| `private_subnet_ids` | Private subnets intended for future ECS, RDS, Redis, and migration tasks. |
| `private_route_table_ids` | Private route tables that should receive the S3 gateway endpoint route. Required before an approved apply when private egress endpoints are enabled. |
| `create_private_egress_endpoints` | Defines the preferred VPC endpoint path for private ECS egress. Defaults to `true`; no NAT Gateway is created. |
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
Redis, ECS task definition, ECS cluster/service, minimal ECS task execution IAM,
ECS task log group, and private VPC endpoint resources:

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
- `aws_security_group.private_egress_endpoints`: security group attached to
  private VPC interface endpoints when `create_private_egress_endpoints` is
  enabled.
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
- `aws_vpc_security_group_egress_rule.ecs_tasks_to_private_egress_endpoints`:
  allows ECS tasks to reach private VPC interface endpoints over HTTPS.
- `aws_vpc_security_group_ingress_rule.private_egress_endpoints_from_ecs_tasks`:
  allows HTTPS inbound to private VPC interface endpoints only from the ECS task
  security group.
- `aws_vpc_security_group_ingress_rule.rds_from_ecs_tasks`: allows PostgreSQL
  from the ECS tasks security group only.
- `aws_vpc_security_group_ingress_rule.redis_from_ecs_tasks`: allows Redis from
  the ECS tasks security group only.
- `aws_vpc_endpoint.s3`: gateway endpoint for S3 access through
  `private_route_table_ids`, needed for ECR layer/object access when using VPC
  endpoints.
- `aws_vpc_endpoint.interface`: interface endpoints for ECR API, ECR Docker,
  CloudWatch Logs, and Secrets Manager in `private_subnet_ids`, with private DNS
  enabled.
- `aws_lb.api`: internet-facing Application Load Balancer in
  `public_subnet_ids`, using the ALB security group.
- `aws_lb_target_group.api`: HTTP target group on `app_port` with
  `target_type = "ip"` for future ECS Fargate API tasks and `/health/ready`
  health checks.
- `aws_lb_listener.http`: MVP HTTP listener on `alb_port` that forwards to the
  API target group. Until an approved deployment registers healthy API targets,
  the listener can return no-target responses from the empty target group.
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
- `aws_secretsmanager_secret.database_url`: metadata-only placeholder for the
  complete `DATABASE_URL` value consumed by ECS tasks. Terraform does not create
  a secret version or store the value.
- `aws_secretsmanager_secret.redis_url`: metadata-only placeholder for the
  complete `redis://` `REDIS_URL` value consumed by ECS tasks. Terraform does
  not create a secret version or store the value.
- `aws_secretsmanager_secret.webhook_secret`: metadata-only placeholder for
  `WEBHOOK_SECRET`. Terraform does not create a secret version or store the
  value.
- `aws_cloudwatch_log_group.api`: log group for future API task logs.
- `aws_cloudwatch_log_group.worker`: log group for future worker task logs.
- `aws_cloudwatch_log_group.migration`: log group for future one-off migration
  task logs.
- `aws_iam_role.ecs_task_execution`: ECS task execution role trusted only by
  `ecs-tasks.amazonaws.com`.
- `aws_iam_role_policy.ecs_task_execution`: minimal execution permissions for
  pulling from the app ECR repository, authorizing ECR image pulls, fetching
  only the configured runtime secret placeholders, and writing streams/events to
  the task log groups.
- `aws_ecs_task_definition.api`: Fargate API task definition using
  `var.container_image`, `node dist/main.js`, the configured `app_port`, and
  the API log group. It injects non-secret runtime environment values plus
  `DATABASE_URL`, `REDIS_URL`, and `WEBHOOK_SECRET` from Secrets Manager.
- `aws_ecs_task_definition.worker`: Fargate worker task definition using
  `var.container_image`, `node dist/worker.js`, and the worker log group. It
  injects non-secret runtime environment values plus `DATABASE_URL`,
  `REDIS_URL`, and `WEBHOOK_SECRET` from Secrets Manager because the worker
  uses the shared application config validation.
- `aws_ecs_task_definition.migration`: Fargate one-off migration task
  definition using `var.container_image`, `npm run migration:run:prod`, and
  the migration log group. It injects non-secret runtime environment values
  plus `DATABASE_URL` from Secrets Manager.
- `aws_ecs_cluster.main`: ECS cluster for the API and worker services.
- `aws_ecs_service.api`: Fargate API service using
  `aws_ecs_task_definition.api.arn`, `private_subnet_ids`,
  `aws_security_group.ecs_tasks.id`, `assign_public_ip = false`, and
  `api_desired_count`. It registers the `api` container on `app_port` with
  `aws_lb_target_group.api.arn`.
- `aws_ecs_service.worker`: Fargate worker service using
  `aws_ecs_task_definition.worker.arn`, `private_subnet_ids`,
  `aws_security_group.ecs_tasks.id`, `assign_public_ip = false`, and
  `worker_desired_count`. It has no load balancer attachment.

The migration task definition uses the compiled production migration script.
The one-off run flow is documented, but a real ECS migration run still requires
explicit live-run approval, the approved image reference, populated
`DATABASE_URL`, approved backend/state handling, approved private egress inputs,
and result recording before API/worker rollout.

The deployed smoke flow is documented, but a real smoke run still requires an
approved deployed API base URL, completed migration/API/worker rollout,
approved non-production webhook values, an approved evidence path, and result
recording. This scaffold does not add smoke automation or prove that a deployed
API is reachable.

The target group health check uses `/health/ready`. That endpoint checks
required app configuration, PostgreSQL, and Redis readiness. This intentionally
favors removing API tasks from ALB rotation when async processing dependencies
are unhealthy, but it also means Redis incidents can remove API tasks even
though some durable PostgreSQL-backed writes may still work. See
[`../../docs/aws-deployment-design.md`](../../docs/aws-deployment-design.md) for
the deployment trade-off.

The RDS instance sets `publicly_accessible = false` and uses the private DB
subnet group. It is reachable only through the existing RDS security group rule
that allows PostgreSQL from the ECS tasks security group. The ECS task
definitions receive `DATABASE_URL` through a dedicated Secrets Manager
placeholder. Terraform does not assemble that URL because doing so safely would
require handling the generated RDS password; instead, an approved deployment
step must populate the placeholder from the RDS endpoint, database name, and
AWS-managed RDS master user secret outside git.

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
accepts only `redis://` URLs. Populate the `REDIS_URL` placeholder with a
`redis://` URL built from the Redis primary endpoint and port. A production move
to Redis TLS should first update client configuration and runtime validation
for `rediss://`, then enable `redis_transit_encryption_enabled` during a
reviewed infrastructure change.

The ECS task definitions include non-secret environment variables through base
locals plus `app_environment_variables`; secret runtime values are injected
through ECS `secrets` references. Do not put `DATABASE_URL`, `REDIS_URL`,
`WEBHOOK_SECRET`, AWS credentials, account IDs, real ARNs, or other secret
values in Terraform or tfvars files. Because secret values are not populated by
Terraform, the task definitions and services remain registration scaffolding,
not a complete runnable deployment.

The ECS services are defined in private subnets with `assign_public_ip = false`.
The preferred private egress path is represented by VPC endpoints: ECR API, ECR
Docker, CloudWatch Logs, and Secrets Manager interface endpoints, plus an S3
gateway endpoint for ECR layer/object access. These resources are still
scaffold only until approved existing VPC, private subnet, and private route
table inputs are supplied and a live apply is explicitly approved. A NAT Gateway
is not defined here and remains an explicit approval and cost-risk alternative.

The services are not ready to run production traffic after apply until a real
container image is available in ECR through the approved publishing path,
runtime secret values are populated through an approved path, the private
egress endpoint inputs and routes are confirmed, and apply/deployment approval
is granted.

`container_image` is the handoff point from the approved image publication to
Terraform. It is consumed by the API, worker, and migration task definitions.
Keep the committed default as the non-routable placeholder
`example.invalid/transaction-event-gateway:replace-me`; for a future approved
deployment, supply the value through an environment-specific ignored tfvars
file or an explicitly approved variable input. Acceptable values are an
approved immutable ECR tag such as
`<ecr-repository-url>:git-<full-commit-sha>` or a digest such as
`<ecr-repository-url>@sha256:<image-digest>`. Do not use `latest`, branch tags,
local-only tags, account-specific repository URLs, account IDs, credentials,
ARNs, tokens, or secrets in committed files without separate approval.

No application task role is defined in this phase because ECS injects configured
runtime secrets before the container starts and the application does not call
AWS APIs at runtime. Add an app task role only when a later AWS-integration
phase needs scoped runtime permissions.

No VPC, subnet, route table, NAT gateway, autoscaling, secret version/value
management, deployment automation, image publication, registry authentication,
one-off migration task runner/workflow, or deployed smoke automation is
implemented in this phase.

Existing VPC, subnet, and private route table IDs are variables only. This
scaffold does not use Terraform data sources or modules.

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

## State backend decision

No remote backend is configured or enabled in this scaffold. The committed
Terraform files intentionally do not contain a `backend` block. During local
review and CI-style validation, use `terraform init -backend=false`; this keeps
validation independent from AWS credentials and avoids creating Terraform
state.

Before any first apply, the deployment owner must approve the Terraform state
owner, region, S3 state bucket, encryption policy, access model, and locking
mechanism. The future backend should use an S3 state bucket with encryption and
either DynamoDB locking or S3-native lockfile locking when supported by the
approved Terraform version.

Backend values must not be committed. Use `backend.hcl.example` as a
placeholder-only template, then supply real values through ignored
`backend.hcl` or an explicitly approved command during a future backend init.
No S3 bucket, DynamoDB table, state file, account ID, ARN, credential, token, or
secret is added by this phase.

The provider lock file is also ignored under `infra/terraform` while this
repository uses temporary-copy or backend-disabled scaffold validation. Revisit
committing `.terraform.lock.hcl` when the first approved remote backend workflow
is established.

## Safe validation commands

These commands are allowed for scaffold review:

```bash
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

`init -backend=false` may download the Terraform provider from the Terraform
registry, but it should not contact AWS APIs and should not require AWS
credentials. If run in the repository rather than a temporary copy, generated
Terraform working files remain untracked by `.gitignore`.

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
