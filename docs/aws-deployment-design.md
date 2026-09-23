# AWS Deployment Design

This document describes the target AWS shape for `transaction-event-gateway` and the decisions behind the Terraform scaffold in `infra/terraform`. The scaffold has never been applied: no image has been pushed to ECR, no remote state exists, and no AWS resource has been created from it.

- [AWS deployment runbook](aws-deployment-runbook.md): first deployment, migration, smoke checks, monitoring window, and teardown.
- [Terraform scaffold notes](../infra/terraform/README.md): resources, variables, secret formats, and local validation.
- [Known gaps before the first apply](#known-gaps-before-the-first-apply): what must be fixed or consciously accepted before anything is created.

## Target Architecture

```text
Internet
  -> Application Load Balancer, public subnets
  -> ECS Fargate API service, private subnets
       -> RDS PostgreSQL, private subnets
       -> ElastiCache Redis, private subnets

ECS Fargate worker service, private subnets
  -> RDS PostgreSQL
  -> ElastiCache Redis

Release
  -> build the image from a commit, push it to ECR with an immutable tag
  -> run the one-off migration task
  -> roll the API and worker services
```

- **ECR** stores images built from the repository `Dockerfile`.
- **ECS Fargate API service** runs the NestJS HTTP process.
- **ECS Fargate worker service** runs the outbox dispatcher and the BullMQ consumer from the same image.
- **One-off ECS migration task** applies the TypeORM migrations from the same image.
- **RDS PostgreSQL** stores payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts; it is the source of truth.
- **ElastiCache Redis** backs BullMQ only.
- **Application Load Balancer** exposes the API. The scaffold defines an HTTP listener only; real client traffic needs an HTTPS listener with an ACM certificate.
- **Secrets Manager** holds `DATABASE_URL`, `REDIS_URL`, and `WEBHOOK_SECRET`; ECS injects them when a task starts.
- **CloudWatch Logs** receives API, worker, and migration task output.
- **VPC endpoints** let the private tasks reach ECR, CloudWatch Logs, Secrets Manager, and S3 without a NAT gateway.

## Architecture Decisions

### ECS Fargate Instead of EKS

The service has two long-running runtime units, one image, and no Kubernetes-specific scheduling needs. ECS Fargate provides isolated services, rolling deployments, IAM roles for tasks, CloudWatch integration, and private networking with a smaller operational surface than EKS. EKS is worth revisiting only for Kubernetes-native platform features or shared cluster workloads.

### Managed RDS and ElastiCache

Managed services keep the effort on the application and its reliability patterns instead of database and Redis host operations. PostgreSQL remains the source of truth. Redis holds only queue state: an outage pauses dispatch and processing, accepted webhooks stay durable in PostgreSQL, and jobs lost with Redis data are re-queued by the worker's reconciliation. The scaffold uses PostgreSQL 16 and Redis 7 to match the local and CI runtimes.

### Separate API and Worker Services

The API and worker run as separate ECS services from one image:

- The API needs ALB routing, HTTP health checks, and request-driven scaling.
- The worker needs no inbound traffic and scales with queue depth and processing latency.
- Failures stay separable: API readiness, outbox dispatch, and worker processing can be investigated and scaled independently.

Both services currently take their image from one Terraform variable, so they roll out together (see the known gaps).

### Terraform State Backend

`versions.tf` declares an empty `backend "s3" {}` block. Backend settings come from an untracked `infra/terraform/backend.hcl` based on the committed `backend.hcl.example`: an S3 bucket with encryption, one state key per environment, and one locking mechanism, either a DynamoDB table or S3-native lockfile locking. The bucket and any lock table are created outside this configuration, so the state never manages its own storage. Local and CI validation run `terraform init -backend=false`, which needs no AWS credentials and creates no state. Bucket names, account IDs, ARNs, and state files are never committed.

### Image Publishing

- Build from a specific commit with the repository `Dockerfile`, for `linux/amd64`, because the task definitions run on X86_64.
- Tag the image `git-<full-commit-sha>`. The ECR repository has immutable tags, scan on push, AES256 encryption, and a lifecycle policy that keeps the 30 most recent images.
- Pass the image to Terraform as `container_image`, preferably by digest (`<repository-url>@sha256:<hex>`); the immutable tag form (`<repository-url>:git-<full-commit-sha>`) also works. `latest`, branch names, and other moving tags are not valid inputs.
- The same `container_image` feeds the API, worker, and migration task definitions.
- CI builds the image locally as `transaction-event-gateway:ci` to check the `Dockerfile`; nothing pushes images or deploys automatically.

The commands are in [Build and push the image](aws-deployment-runbook.md#build-and-push-the-image).

## Runtime Units

### API Service

- ECS service and task definition family `<project_name>-<environment>-api`, container `api`, command `node dist/main.js`, port `app_port` (default `3000`).
- `api_desired_count` defaults to `1`. Production-like availability needs at least two tasks in different Availability Zones.
- Inbound traffic comes only from the ALB security group.
- The API keeps idle HTTP connections open for 65 seconds, longer than the ALB idle timeout of 60 seconds that `alb.tf` leaves at its default, so the ALB does not reuse a connection that the task is closing, which would end in a 502 (`src/common/bootstrap.ts`).
- The ALB target group checks `GET /health/serving` (configuration and PostgreSQL), so a Redis incident does not drain API tasks that can still create payment intents and accept webhooks. `GET /health/ready` (configuration, PostgreSQL, and Redis) is the check for operators and deployments.
- Rate limiting is process-local, in memory, and keyed by the request source that Nest/Express observes. Behind the ALB that source is not the end client, and limiter state is not shared between tasks. Real multi-client traffic needs proxy-aware forwarded-IP handling and a shared limiter, or an explicit decision to accept this limitation.

### Worker Service

- ECS service and task definition family `<project_name>-<environment>-worker`, container `worker`, command `node dist/worker.js`; no load balancer and no inbound traffic.
- `worker_desired_count` defaults to `1`. Increase it only after queue depth, row-lock contention, and processing latency have been observed.
- Outbound traffic goes to PostgreSQL, Redis, CloudWatch Logs, and Secrets Manager.
- `OUTBOX_DISPATCH_ENABLED=true` runs the outbox dispatcher; `false` pauses publication deliberately.
- Every 60 seconds the dispatcher runner moves at most 100 outbox rows that were `PUBLISHED` more than 10 minutes ago, and whose webhook event is still `RECEIVED` or `QUEUED`, back to `FAILED` with `next_attempt_at = now()`; the regular dispatcher then republishes their jobs. This covers jobs lost with Redis data and jobs whose retries were exhausted. Duplicate jobs are harmless because processing is idempotent.

### Migration Task

- Task definition family `<project_name>-<environment>-migration`, container `migration`, command `npm run migration:run:prod`. It is not a service: `aws ecs run-task` starts it in the private subnets with the ECS task security group.
- It receives the shared non-secret environment and only `DATABASE_URL` from Secrets Manager.
- It must exit with code `0` before new code that expects the new schema starts. The scaffold does not enforce this order (see the known gaps).
- Check destructive, long-running, or data-rewriting migrations for lock behavior, duration, and rollback limits before running them against a shared database.

## Secrets and Environment

All three task definitions receive the same non-secret environment from `ecs-tasks.tf`; entries in `app_environment_variables` override it:

| Variable | Value in the task definitions |
| --- | --- |
| `NODE_ENV` | `production` |
| `LOG_FORMAT` | `json` |
| `PORT` | `app_port` (default `3000`) |
| `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` | `300` |
| `OUTBOX_DISPATCH_ENABLED` | `true` |
| `OUTBOX_DISPATCH_INTERVAL_MS` | `1000` |
| `OUTBOX_MAX_ATTEMPTS` | `10`; reserved, transient publish failures retry indefinitely |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_TTL_SECONDS`, `RATE_LIMIT_LIMIT` | `true`, `60`, `100` |
| `SWAGGER_ENABLED` | `false` |

Secret values come from Secrets Manager secrets that Terraform creates without values:

| Secret | Injected into | Value |
| --- | --- | --- |
| `DATABASE_URL` | API, worker, migration | PostgreSQL URL with a percent-encoded password and TLS parameters; see the [`DATABASE_URL` format](../infra/terraform/README.md#database_url-secret-format). |
| `REDIS_URL` | API, worker | `redis://<host>:<port>`, or `rediss://` with transit encryption. |
| `WEBHOOK_SECRET` | API, worker | HMAC secret of at least 16 characters. Only the API verifies signatures. |

AWS credentials never go into the application environment. The task execution role pulls the image, reads the three secrets, and writes logs. The application calls no AWS APIs at runtime, so there is no task role. The application has no log-level setting.

## Networking and Security

- Public subnets hold the ALB; private subnets hold the ECS tasks, RDS, and Redis. The scaffold takes an existing VPC, subnets, and route tables as inputs and creates none of them.
- Tasks run without public IPs. By default they reach AWS through interface endpoints for ECR API, ECR Docker, CloudWatch Logs, and Secrets Manager, and through an S3 gateway endpoint for ECR image layers. With `create_private_egress_endpoints = false`, the task security group allows HTTPS to any address instead and the VPC must provide a NAT route; the scaffold creates no NAT gateway.
- RDS and Redis have no public endpoints.

Security groups:

- **ALB**: inbound HTTP on `alb_port` (default `80`) from `allowed_http_cidrs` (default `0.0.0.0/0`); outbound only to the tasks on `app_port`.
- **ECS tasks**, shared by the API, worker, and migration task: inbound `app_port` only from the ALB; outbound to PostgreSQL, Redis, the interface endpoints on 443, and the S3 prefix list on 443.
- **Interface endpoints**: inbound 443 only from the ECS task security group.
- **RDS** and **Redis**: inbound on their ports only from the ECS task security group.

IAM: the task execution role is trusted only by `ecs-tasks.amazonaws.com` and may get an ECR authorization token, pull from the application repository, read the three runtime secrets, and write to the three task log groups. A future deployment pipeline role should be limited to pushing to this repository and updating these two services.

## Release and Rollback Strategy

Intended release order:

1. Build the image from a commit, push it to ECR, and record the digest.
2. Register task definitions that use the new image.
3. Run the migration task; stop the release on a non-zero exit code.
4. Roll the API service, then the worker service.
5. Check `/health/serving` through the ALB and `/health/ready` as the operator check, then run the deployed smoke checks.
6. Watch logs, outbox progress, and ALB 5xx responses during a monitoring window.

In the scaffold, steps 2 and 4 happen in the same `terraform apply` of a new `container_image`, so step 3 cannot run between them. The runbook works around this for the first deployment by keeping both services at zero tasks until the migration has succeeded; see [Migrate and start the services](aws-deployment-runbook.md#migrate-and-start-the-services).

Migrations should stay backward compatible with the code that is still running (expand and contract: add schema, deploy code, backfill, and remove old schema in a later release). Destructive, revert, and large data-rewrite migrations need a written plan, including how to restore, before they run.

Rollback:

- Set `container_image` back to the previous digest and apply. Every image change replaces the task definitions, and because `skip_destroy` is not set, Terraform deregisters the previous revisions; a rollback therefore goes through Terraform rather than pointing a service at an old revision.
- Rollback is straightforward only while the schema stays compatible with the previous image.
- Redis queue state is not authoritative. Duplicate job delivery after a rollback is safe: the worker reloads rows from PostgreSQL under row locks, and processing is idempotent.

CI runs the code, Docker, and Terraform checks but has no AWS access. A deploy pipeline would add an OIDC role limited to this ECR repository and these two ECS services, push by digest, run the migration task with a stop on failure, wait for the services to reach a steady state, and run the deployed smoke checks.

## Observability Minimum

Provided by the scaffold and the application:

- Log groups `/ecs/<name_prefix>/api`, `/ecs/<name_prefix>/worker`, and `/ecs/<name_prefix>/migration`, kept for `ecs_log_retention_days` (default 30).
- Structured log events with correlation IDs and safe identifiers, one JSON object per line (`LOG_FORMAT=json`), so CloudWatch Logs filter patterns can match fields such as `{ $.event = "worker_job_processed" }`.
- ALB health checks on `/health/serving` every 30 seconds; two consecutive failures mark a task unhealthy.
- ECS service events and stopped-task reasons.

Not provided: CloudWatch alarms, dashboards, Container Insights, ALB access logs, tracing, and dead-letter inspection tooling. Before an environment runs unattended, add at least alarms on ALB 5xx responses, unhealthy targets, RDS free storage, and the log events listed in the runbook's [monitoring window](aws-deployment-runbook.md#monitoring-window).

## Risks

- The ALB listener is plain HTTP and `allowed_http_cidrs` defaults to `0.0.0.0/0`, so request bodies cross the internet unencrypted until an HTTPS listener exists.
- Health endpoints are public and exempt from rate limiting, and the PostgreSQL health check uses a one-connection pool with a one-second connection timeout. A burst of requests to `/health/serving` can fail the ALB health checks and drain the API tasks.
- The worker task has no container health check, so ECS keeps a hung worker running.
- RDS is single-AZ and Redis is one node without failover by default; Redis transit encryption is off by default.
- Rotating `WEBHOOK_SECRET` needs application support for overlapping old and new secrets, which does not exist.
- There is no manual retry API or admin tooling; recovery beyond the automatic outbox retries and reconciliation means inspecting PostgreSQL directly.
- Worker scaling should stay conservative until queue behavior and row-lock contention have been measured.

## Known Gaps Before the First Apply

1. **PostgreSQL version.** `postgres_engine_version` defaults to `"16.6"` (`infra/terraform/variables.tf`; `example.tfvars` repeats it). RDS no longer offers 16.6 for new instances, so the first apply fails. Pin a currently available 16.x minor version.
2. **Migration order.** One `container_image` feeds the API, worker, and migration task definitions (`infra/terraform/ecs-tasks.tf`). Changing it moves both services to new revisions in the same apply, with `desired_count = 1` by default, no deployment circuit breaker, and no wait for a steady state (`infra/terraform/ecs-services.tf`). A migration cannot run before the new code starts, and `/health/serving` passes against an empty schema: it only runs `SELECT 1` (`src/health/postgres-health-check.service.ts`), and the application neither creates nor migrates tables at startup (`src/database/typeorm-options.ts`).
3. **Redis eviction policy.** `infra/terraform/redis.tf` sets no `parameter_group_name`, so ElastiCache uses the default parameter group, whose `maxmemory-policy` is `volatile-lru`. BullMQ requires `noeviction`; add a parameter group that sets it.
4. **Interface endpoints.** `infra/terraform/private-egress.tf` places each interface endpoint in every subnet of `private_subnet_ids` with private DNS enabled. An interface endpoint accepts one subnet per Availability Zone, private DNS requires the VPC attributes DNS hostnames and DNS support, and existing endpoints with private DNS for the same services in the VPC conflict with these, as does an existing S3 gateway endpoint on the same route tables.
5. **Database user.** The API and worker connect to RDS as the master user, the only database user the scaffold provisions (`infra/terraform/rds.tf`); there is no least-privilege application role.
6. **CPU architecture.** The task definitions set no `runtime_platform` (`infra/terraform/ecs-tasks.tf`), so Fargate runs X86_64 images. An image built on an ARM machine without `--platform linux/amd64` does not start.
7. **Database TLS and password rotation.** The image does not ship the Amazon RDS CA bundle (`Dockerfile`) that `sslmode=verify-full` needs, so database connections fail until it does. The RDS-managed master password rotates on a schedule, while `DATABASE_URL` is a static copy read at task start: after a rotation, tasks cannot open new connections until the secret is re-populated and the services are redeployed.
8. **Retention and exposure.** No job deletes old webhook, idempotency, or outbox rows. `POST /payment-intents` requires no authentication (webhooks require only a valid signature), and every endpoint accepts JSON bodies up to 256 KB (`src/common/bootstrap.ts`), while RDS storage starts at 20 GiB and autoscales to 100 GiB (`infra/terraform/variables.tf`). Decide storage sizing, retention, and who may reach the ALB (`allowed_http_cidrs`) before exposing it.
9. **Worker secret.** The worker task receives `WEBHOOK_SECRET` (`infra/terraform/ecs-tasks.tf`) although it never verifies signatures, because the shared configuration validation requires it (`src/config/env.validation.ts`).

## Out of Scope

Kubernetes or EKS, multi-region deployment, blue/green automation, autoscaling policies, a full observability stack (dashboards, alerting, tracing, SLOs), a manual retry API or admin UI, a NAT gateway, a secret rotation workflow, and deployment automation.
