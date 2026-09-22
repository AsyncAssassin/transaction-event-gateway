# AWS Terraform Scaffold

Terraform configuration for running `transaction-event-gateway` on AWS: ECS Fargate API and worker services with a one-off migration task definition, private RDS PostgreSQL, private ElastiCache Redis, an HTTP Application Load Balancer, ECR, Secrets Manager placeholders for the runtime secrets, CloudWatch log groups, a minimal task execution role, security groups, and private VPC endpoints. The configuration has never been applied. Formatting and validation need no AWS credentials.

- [AWS deployment design](../../docs/aws-deployment-design.md): target shape, decisions, and the [known gaps before the first apply](../../docs/aws-deployment-design.md#known-gaps-before-the-first-apply).
- [AWS deployment runbook](../../docs/aws-deployment-runbook.md): first deployment, migration, smoke checks, monitoring, and teardown.

## Contents

- `versions.tf`: Terraform `>= 1.6.0, < 2.0.0`, AWS provider `>= 5.0, < 7.0`, and the empty `backend "s3" {}` block.
- `providers.tf`: AWS provider with the region from `aws_region` and the common tags as default tags; no credentials.
- `backend.hcl.example`: template for the untracked `backend.hcl`.
- `variables.tf`: the inputs listed below.
- `locals.tf`: the name prefix `<project_name>-<environment>` and the common tags.
- `main.tf`: comments only.
- `ecr.tf`: ECR repository and lifecycle policy.
- `security-groups.tf`: security groups and rules for the ALB, ECS tasks, interface endpoints, RDS, and Redis.
- `private-egress.tf`: S3 gateway endpoint and interface endpoints for ECR API, ECR Docker, CloudWatch Logs, and Secrets Manager.
- `alb.tf`: internet-facing ALB, IP target group, and HTTP listener.
- `rds.tf`: DB subnet group and PostgreSQL instance.
- `redis.tf`: ElastiCache subnet group and Redis replication group.
- `runtime-config.tf`: Secrets Manager secrets for `DATABASE_URL`, `REDIS_URL`, and `WEBHOOK_SECRET`, without values.
- `ecs-tasks.tf`: log groups, task execution role and policy, and the API, worker, and migration task definitions.
- `ecs-services.tf`: ECS cluster and the API and worker services.
- `outputs.tf`: names, endpoints, and ARNs used by the runbook.
- `example.tfvars`: placeholder values for validation and a starting point for a real tfvars file; it contains no real IDs or secrets.

## Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `aws_region` | `us-east-1` | Region for all resources. |
| `project_name` | `transaction-event-gateway` | 3 to 48 lowercase letters or digits with single hyphens between segments. |
| `environment` | `dev` | 2 to 32 characters, same rules. `<project_name>-<environment>` names the ALB and target group, which allow 32 characters, so the default project name leaves at most six characters for the environment; validation does not check this. |
| `container_image` | `example.invalid/transaction-event-gateway:replace-me` | Image for all three task definitions: an ECR digest or immutable tag, never `latest`. |
| `api_task_cpu`, `api_task_memory` | `512`, `1024` | Fargate CPU units and MiB for the API task. Validation checks each value separately; the pair must also be a supported Fargate combination. |
| `worker_task_cpu`, `worker_task_memory` | `512`, `1024` | Same for the worker task. |
| `migration_task_cpu`, `migration_task_memory` | `256`, `512` | Same for the migration task. |
| `api_desired_count` | `1` | API tasks; `0` is allowed. |
| `worker_desired_count` | `1` | Worker tasks; `0` is allowed. |
| `health_check_path` | `/health/serving` | ALB target health check (configuration and PostgreSQL only). |
| `health_check_grace_period_seconds` | `60` | Time before the API service acts on failed ALB health checks of a new task. |
| `ecs_log_retention_days` | `30` | Retention of the three task log groups. |
| `app_environment_variables` | `{}` | Extra or overriding non-secret environment for all task definitions; see the base values in the [design](../../docs/aws-deployment-design.md#secrets-and-environment). Keys must be uppercase and must not be `DATABASE_URL`, `REDIS_URL`, `WEBHOOK_SECRET`, or AWS credentials. A `PORT` that differs from `app_port` makes the container listen on a port the target group does not use. |
| `create_vpc` | `false` | Reserved; no VPC resources are defined, and the value only changes the `networking_mode` output. |
| `vpc_id` | `null` | Existing VPC. |
| `public_subnet_ids` | `[]` | Existing public subnets for the ALB, in at least two Availability Zones. |
| `private_subnet_ids` | `[]` | Existing private subnets for the tasks, RDS, Redis, and interface endpoints: one per Availability Zone, at least two zones. |
| `private_route_table_ids` | `[]` | Route tables of the private subnets; they receive the S3 gateway endpoint route. A precondition fails the plan when the list is empty and endpoints are enabled. |
| `create_private_egress_endpoints` | `true` | Create the VPC endpoints. With `false`, the task security group allows HTTPS to any address and the VPC must provide a NAT route. |
| `allowed_http_cidrs` | `["0.0.0.0/0"]` | IPv4 CIDR blocks allowed to reach the ALB. |
| `app_port` | `3000` | Container port, target group port, and the default `PORT`. |
| `alb_port` | `80` | ALB HTTP listener port. |
| `alb_enable_deletion_protection` | `false` | ALB deletion protection. |
| `postgres_port` | `5432` | PostgreSQL port. |
| `postgres_engine_version` | `16.6` | RDS no longer offers 16.6 for new instances; set a currently available 16.x version. |
| `postgres_instance_class` | `db.t4g.micro` | RDS instance class. |
| `postgres_allocated_storage` | `20` | Initial storage in GiB. |
| `postgres_max_allocated_storage` | `100` | Storage autoscaling limit in GiB. |
| `postgres_db_name` | `transaction_event_gateway` | Initial database name. |
| `postgres_username` | `app` | Master username; RDS manages the password in its own Secrets Manager secret. |
| `postgres_backup_retention_days` | `7` | Automated backup retention in days. |
| `postgres_multi_az` | `false` | Multi-AZ deployment. |
| `postgres_deletion_protection` | `false` | RDS deletion protection. |
| `postgres_skip_final_snapshot` | `true` | With `false`, destroy keeps a final snapshot named `<name_prefix>-postgres-final-snapshot`. |
| `redis_port` | `6379` | Redis port. |
| `redis_node_type` | `cache.t4g.micro` | ElastiCache node type. |
| `redis_engine_version` | `7.1` | Redis engine version. |
| `redis_num_cache_clusters` | `1` | Nodes in the replication group; at least `2` with automatic failover. |
| `redis_automatic_failover_enabled` | `false` | Automatic failover. |
| `redis_multi_az_enabled` | `false` | Multi-AZ; requires automatic failover. |
| `redis_at_rest_encryption_enabled` | `true` | At-rest encryption. |
| `redis_transit_encryption_enabled` | `false` | In-transit encryption; with `true`, `REDIS_URL` must use `rediss://`. |
| `redis_snapshot_retention_limit` | `7` | Automatic snapshot retention in days; `0` disables snapshots. |
| `redis_apply_immediately` | `false` | `false` defers Redis changes to the next maintenance window. |
| `tags` | `{}` | Extra tags merged into the default tags. |

## Resources

**ECR.** `aws_ecr_repository.app`, named `<name_prefix>`, has immutable tags, scan on push, and AES256 encryption; `aws_ecr_lifecycle_policy.app` expires all but the 30 most recent images. There is no `force_delete`, so destroy fails while the repository holds images.

**Load balancer.** `aws_lb.api` is internet-facing in `public_subnet_ids`. `aws_lb_target_group.api` forwards HTTP to `app_port` with `target_type = "ip"` and checks `health_check_path` every 30 seconds (5-second timeout, two checks to change state, `200` expected). `aws_lb_listener.http` forwards `alb_port` to the target group. There is no HTTPS listener, certificate, redirect, WAF, or access logging.

**ECS.** `aws_ecs_cluster.main` (`<name_prefix>-cluster`, no Container Insights) runs `aws_ecs_service.api` and `aws_ecs_service.worker` on Fargate in `private_subnet_ids` with the ECS task security group and `assign_public_ip = false`. The API service registers container `api` on `app_port` with the target group; the worker has no load balancer. The services have no autoscaling and no deployment circuit breaker, and Terraform does not wait for them to reach a steady state.

| Task definition | Command | Secrets | Log group |
| --- | --- | --- | --- |
| `aws_ecs_task_definition.api` | `node dist/main.js` | `DATABASE_URL`, `REDIS_URL`, `WEBHOOK_SECRET` | `/ecs/<name_prefix>/api` |
| `aws_ecs_task_definition.worker` | `node dist/worker.js` | `DATABASE_URL`, `REDIS_URL`, `WEBHOOK_SECRET` | `/ecs/<name_prefix>/worker` |
| `aws_ecs_task_definition.migration` | `npm run migration:run:prod` | `DATABASE_URL` | `/ecs/<name_prefix>/migration` |

All three use `container_image`, the same non-secret environment, and the task execution role. They set no `runtime_platform` (Fargate runs X86_64) and no task role. The worker needs `WEBHOOK_SECRET` only because the shared configuration validation requires it.

**IAM and logs.** `aws_iam_role.ecs_task_execution` is trusted only by `ecs-tasks.amazonaws.com`. Its inline policy allows `ecr:GetAuthorizationToken`, pulling from the application repository, `secretsmanager:GetSecretValue` on the three runtime secrets, and writing log streams and events to the three task log groups. The log groups keep events for `ecs_log_retention_days` and are deleted on destroy.

**Secrets.** `aws_secretsmanager_secret.database_url`, `.redis_url`, and `.webhook_secret` are named `<name_prefix>/runtime/database-url`, `/redis-url`, and `/webhook-secret` and have a 7-day recovery window. Terraform creates no secret versions, so the values never enter the Terraform state.

**RDS.** `aws_db_subnet_group.postgres` uses `private_subnet_ids`. `aws_db_instance.postgres` (`<name_prefix>-postgres`) has encrypted `gp3` storage with autoscaling, `publicly_accessible = false`, the RDS security group, automated backups, `copy_tags_to_snapshot`, `apply_immediately = false`, `auto_minor_version_upgrade = true`, and the default parameter group. With `manage_master_user_password = true`, RDS keeps the master password in its own Secrets Manager secret, whose ARN is the sensitive output `postgres_master_user_secret_arn`.

**Redis.** `aws_elasticache_subnet_group.redis` uses `private_subnet_ids`. `aws_elasticache_replication_group.redis` (`<name_prefix>-redis`) has the Redis security group, the default parameter group, and by default at-rest encryption and automatic snapshots; it takes no final snapshot on delete. Preconditions require at least two nodes for automatic failover and automatic failover for Multi-AZ. Redis is queue infrastructure only; PostgreSQL holds the durable state.

**Networking.** The configuration uses an existing VPC, subnets, and route tables and creates none of them; there is no NAT gateway. `aws_vpc_endpoint.s3` is a gateway endpoint on `private_route_table_ids`. `aws_vpc_endpoint.interface` creates endpoints for `ecr.api`, `ecr.dkr`, `logs`, and `secretsmanager` in every subnet of `private_subnet_ids`, with private DNS enabled. Security group rules:

- ALB: inbound HTTP on `alb_port` from `allowed_http_cidrs`; outbound to the tasks on `app_port`.
- ECS tasks: inbound `app_port` from the ALB; outbound to PostgreSQL, Redis, the interface endpoint security group on 443, and the S3 prefix list on 443. ECR serves image layers from S3, so without the S3 rule image pulls fail with `CannotPullContainerError`. With `create_private_egress_endpoints = false`, one rule allowing 443 to `0.0.0.0/0` replaces the two endpoint rules.
- Interface endpoints: inbound 443 from the ECS task security group.
- RDS and Redis: inbound on their ports from the ECS task security group only.

## `DATABASE_URL` Secret Format

Store the value as plain text, not as a JSON key/value secret:

```text
postgresql://<username>:<percent-encoded-password>@<postgres_address>:<postgres_port>/<postgres_database_name>?sslmode=verify-full&sslrootcert=<path-to-rds-ca-bundle>
```

- `<postgres_address>`, `<postgres_port>`, and `<postgres_database_name>` are the Terraform outputs of the same names. Do not use `postgres_endpoint` here: it already ends with `:<port>`.
- `<username>` and the password are the `username` and `password` keys of the RDS-managed secret whose ARN is the `postgres_master_user_secret_arn` output; the username equals `postgres_username`.
- Percent-encode the password, for example with `encodeURIComponent` or jq's `@uri`. RDS-generated passwords can contain `#`, `?`, or `%`: unencoded, `#` and `?` break URL parsing at startup, `%` followed by non-hex characters fails with `URI malformed`, and `%` followed by two hex digits silently decodes into a different password.
- RDS for PostgreSQL 15 and later rejects unencrypted connections by default (`rds.force_ssl = 1`). The `pg` driver treats `sslmode=require` as `verify-full`, so the Amazon RDS CA bundle must be trusted: reference a bundle file shipped in the image with `sslrootcert`, or point `NODE_EXTRA_CA_CERTS` at it. The current image does not contain the bundle.
- The RDS-managed master password rotates on a schedule, while `DATABASE_URL` is a static copy read at task start. After a rotation, re-populate the secret and redeploy the services. A longer-lived environment should inject only the `password` key of the managed secret and build the URL in the application.
- Configuration validation reports a malformed URL without echoing it, so a wrongly formatted secret does not print the password into task logs.

The runbook builds this value from the outputs without exposing the password. The other two secrets are `REDIS_URL` (`redis://<redis_primary_endpoint_address>:<redis_port>`, or `rediss://` with `redis_transit_encryption_enabled = true`; the TLS path has not been exercised against ElastiCache) and `WEBHOOK_SECRET` (a random value of at least 16 characters). Never put these values, AWS credentials, account IDs, or real ARNs into `.tf` files or committed tfvars files.

## State Backend

`versions.tf` contains an empty `backend "s3" {}` block, so `plan` and `apply` need `terraform init -backend-config=backend.hcl` first. Create `backend.hcl` from `backend.hcl.example` (git ignores it): an S3 state bucket with encryption, a state key per environment, the region, and exactly one locking mechanism, either a DynamoDB table or `use_lockfile = true` for S3-native locking on Terraform versions that support it. The bucket and any lock table are created outside this configuration. Never commit bucket names, account IDs, ARNs, credentials, or state files.

The provider lock file `.terraform.lock.hcl` is ignored by git; commit it once the configuration is applied from a shared backend, so every operator uses the same provider builds.

## Local Validation

These commands need no AWS credentials and create no state; CI runs the same three:

```bash
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

`init -backend=false` downloads the AWS provider from the Terraform registry but does not contact AWS. The generated `.terraform/` directory is ignored by git.

## Commands That Create or Destroy Resources

`terraform plan` needs AWS credentials and the initialized backend but changes nothing. The following commands create, change, or delete billable resources; the [runbook](../../docs/aws-deployment-runbook.md) gives their order and arguments:

- `terraform -chdir=infra/terraform apply` and `terraform -chdir=infra/terraform destroy`, with the environment's tfvars file.
- `docker push` to the ECR repository, after `aws ecr get-login-password | docker login ...`.
- `aws ecs run-task` for the migration task.
- `aws secretsmanager put-secret-value` for the runtime secrets.
