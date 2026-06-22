# AWS Deployment Design

## Metadata

| Field | Value |
| --- | --- |
| Status | Design with incremental Terraform scaffold |
| Scope | MVP AWS deployment architecture |
| Last updated | 2026-06-22 |

## Scope

This document describes a recommended MVP AWS deployment shape for `transaction-event-gateway`. It is a handoff document for incremental infrastructure phases.

The current Terraform scaffold implements ECR, security groups, the MVP HTTP ALB path, private RDS PostgreSQL, private ElastiCache Redis, Secrets Manager placeholders for runtime values, ECS Fargate task definitions, an ECS cluster, API and worker ECS services, task log groups, a minimal ECS task execution role, and a configurable private VPC endpoint egress path. It documents the Terraform backend/state decision, the ECR image publishing path, the one-off ECS migration task flow, and the deployed smoke test flow, but does not enable a remote backend. It does not publish an image, configure registry authentication, run migrations, define autoscaling, populate secret values, add deployment workflows, create NAT gateways, run deployed smoke tests, or provide live deployment behavior.

Before any live AWS usage, review
[AWS deploy guardrails](aws-deploy-guardrails.md) for cost guardrails,
first-deploy prerequisites, and teardown ownership. Use
[AWS short-lived deploy runbook](aws-short-lived-deploy-runbook.md) to connect
the guardrails, backend/state owner, private egress inputs, secret population,
image approval, migration gate, rollout gate, smoke gate, monitoring window,
and teardown decision into one future go/no-go order.

## Recommended MVP Architecture

```text
Internet
  -> Application Load Balancer, public subnets
  -> ECS Fargate API service, private subnets
  -> RDS PostgreSQL, private subnets
  -> ElastiCache Redis, private subnets

ECS Fargate worker service, private subnets
  -> RDS PostgreSQL
  -> ElastiCache Redis

CI/CD
  -> build and verify Docker image locally
  -> approve immutable image publication
  -> publish image to ECR
  -> run one-off migration task
  -> roll ECS API and worker services
```

Core AWS services:

- **ECR** stores versioned application images produced from the existing Dockerfile after an explicit publishing approval.
- **ECS Fargate API service** runs the NestJS HTTP process from the shared image.
- **ECS Fargate worker service** runs the BullMQ worker process from the same image with a worker command override.
- **RDS PostgreSQL** stores payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts.
- **ElastiCache Redis** backs BullMQ queue infrastructure only.
- **Application Load Balancer** exposes the API service over HTTPS.
- **Secrets Manager or SSM Parameter Store** stores runtime secrets and environment configuration.
- **CloudWatch Logs** receives API, worker, migration, and ECS task logs.

## Architecture Decisions

### ECS Fargate Instead of EKS

ECS Fargate is the recommended MVP target because the service has two simple runtime units, one container image, and no Kubernetes-specific scheduling needs. It reduces operational surface area while still giving isolated services, rolling deployments, IAM task roles, CloudWatch integration, and private networking.

EKS is not needed for the MVP. It can be revisited only if later phases require Kubernetes-native platform features, shared cluster workloads, or advanced scheduling patterns.

### Managed RDS and ElastiCache

RDS and ElastiCache keep the MVP focused on the service and its reliability patterns instead of database and Redis host operations. PostgreSQL remains the source of truth. Redis remains disposable queue infrastructure; losing Redis availability pauses dispatch and processing, but accepted webhook work remains durable in PostgreSQL outbox rows.

Use PostgreSQL 16 and Redis 7 where practical to match the local and CI runtime assumptions.

### Separate API and Worker Services

The API and worker should be separate ECS services even though they use the same image:

- The API service needs ALB routing, HTTP health checks, and request-driven scaling.
- The worker service needs no inbound traffic and is scaled by background workload, queue depth, and processing latency.
- Deploying separately lets the release process roll API and worker tasks independently while keeping the same image version.
- Operational failures are easier to isolate: API readiness, outbox dispatch, and worker processing can be investigated separately.

### Terraform State Backend

The current decision is documentation-first: no active Terraform backend block is committed and no remote backend is enabled in this scaffold. Local validation should continue to use `terraform init -backend=false` so review does not create local or remote Terraform state.

Before any first apply, the deployment owner must approve the Terraform state owner and backend configuration. The future remote backend should use an S3 state bucket with encryption and an approved locking mechanism, either DynamoDB locking or S3-native lockfile locking when supported by the approved Terraform version. Backend values must come from an untracked `infra/terraform/backend.hcl` file based on the committed template or from an explicitly approved command; real bucket names, lock table names, account IDs, ARNs, credentials, and state files must not be committed.

### ECR Image Publishing

The ECR image publishing path is documented in
[ECR image publishing path](ecr-image-publishing.md). The path is
approval-gated and has not been executed in this phase.

Image selection starts with a reviewed commit SHA. The Docker image should be
built from that exact source revision using the existing `Dockerfile`, verified
with the current checks, and tagged with an immutable tag such as
`git-<full-commit-sha>`. After publication, a registry digest is preferred for
production-like Terraform inputs. Mutable tags such as `latest`, branch names,
or moving release labels are not acceptable deployment inputs.

Publication approval must happen after typecheck, lint, tests, build, Docker
image build, audit, schema, forbidden wording, and credentials/account-safety
checks pass, and before registry authentication or image publication. The
approver should be the deployment owner for the target environment.

Terraform receives the approved image through `container_image`, using either
the immutable tag form or the digest form. The same image reference is consumed
by API, worker, and migration task definitions. Real ECR repository URLs,
account IDs, credentials, ARNs, tokens, and secrets must not be added to
committed docs, examples, or Terraform variable files without separate
approval.

## Runtime Units

### API Service

- ECS service: Terraform names this as `{project_name}-{environment}-api`.
- Image: approved image digest or immutable tag from ECR.
- Command: default image command, currently the API process.
- Desired count: start with at least 2 tasks for production-like availability; staging may use 1.
- Inbound: ALB target group only.
- Health check: ALB target group should use `GET /health/ready` so traffic reaches only tasks with required config, PostgreSQL, and Redis connectivity.
- Public endpoints: REST API, Swagger, and health endpoints through the ALB.

### Worker Service

- ECS service: Terraform names this as `{project_name}-{environment}-worker`.
- Image: same image digest or immutable tag as the API release.
- Command override: run the worker entrypoint, for example `node dist/worker.js`.
- Desired count: start with 1 for MVP; increase only after queue depth, lock behavior, and processing latency are observed.
- Inbound: none.
- Outbound: PostgreSQL, Redis, CloudWatch Logs, and AWS APIs needed for secrets.
- Dispatcher: enabled with `OUTBOX_DISPATCH_ENABLED=true` unless a controlled maintenance window requires pausing publication.

### Migration Task

- ECS one-off task: uses the same image version as the release.
- Command override: run database migrations before rolling API and worker services with `npm run migration:run:prod`.
- Secrets: receives `DATABASE_URL` only.
- Network: private subnets with access to RDS, Secrets Manager, CloudWatch Logs, and the approved private egress path.
- Execution: must finish successfully before service rollout proceeds.
- Safety: production migrations require review for lock behavior, runtime duration, rollback limits, and destructive/revert risk.
- Run flow: see [One-off ECS migration task flow](aws-migration-task-flow.md). The flow is documented only; no live run is approved by this document.

## Secrets and Environment

Use Secrets Manager or SSM Parameter Store. Secrets Manager is preferred for high-sensitivity values and rotation workflows; SSM Parameter Store is acceptable for simpler MVP configuration if access is tightly scoped.

Required or expected runtime values:

| Variable | Storage | Applies to | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | Parameter | API, worker, migration task | Use `production` for deployed environments. |
| `PORT` | Parameter | API | Container listen port, default-compatible value is `3000`. |
| `DATABASE_URL` | Secret | API, worker, migration task | RDS PostgreSQL connection string. Do not expose publicly. |
| `REDIS_URL` | Secret or parameter | API, worker | ElastiCache Redis connection string. |
| `WEBHOOK_SECRET` | Secret | API | HMAC verification secret. Rotate with care; multi-secret rotation is future work. |
| `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` | Parameter | API | Default-compatible value is `300`. |
| `OUTBOX_DISPATCH_ENABLED` | Parameter | Worker | Usually `true`; can pause queue publication when set to `false`. |
| `OUTBOX_DISPATCH_INTERVAL_MS` | Parameter | Worker | Default-compatible value is `1000`. |
| `LOG_LEVEL` | Parameter | API, worker | Deployment target value for logging policy. Current code should be checked before relying on runtime log-level control. |

Do not store AWS credentials inside application environment variables. Use ECS task execution roles and task roles.

## Networking and Security

Recommended VPC layout:

- Public subnets contain the ALB.
- Private application subnets contain ECS API and worker tasks.
- Private data subnets contain RDS PostgreSQL and ElastiCache Redis.
- ECS tasks should reach ECR, CloudWatch Logs, Secrets Manager, and S3-backed ECR layer objects through VPC endpoints by default. A NAT Gateway is an explicit approval and cost-risk alternative.
- RDS and Redis have no public endpoint.

Security group model:

- **ALB security group**: inbound `443` from allowed public clients; outbound only to the API service port.
- **API task security group**: inbound API port only from the ALB security group; outbound to RDS, Redis, and the private endpoint security group for required AWS APIs.
- **Worker task security group**: no inbound rules; outbound to RDS, Redis, and the private endpoint security group for required AWS APIs.
- **Private endpoint security group**: inbound HTTPS only from the ECS task security group for interface endpoints. S3 gateway endpoint access is routed through approved private route tables.
- **RDS security group**: inbound PostgreSQL port only from API and worker task security groups.
- **Redis security group**: inbound Redis port only from API and worker task security groups.

IAM model:

- ECS task execution role can pull from ECR, write CloudWatch logs, and fetch configured secrets.
- The current Terraform scaffold includes execution permissions for ECR image pulls, task logs, and the specific runtime Secrets Manager placeholders referenced by ECS task definitions.
- Application task role should be minimal. At MVP, it may only need read access to the specific secrets or parameters if the application loads them at runtime instead of ECS injecting them.
- A future CI/CD role can publish to the specific ECR repository and update the specific ECS services, but should not have broad administrator access.

## Migration and Release Flow

Recommended future release order:

1. Select the reviewed commit SHA for release.
2. Run existing verification, including image build verification.
3. Approve image publication for the target environment.
4. Publish the immutable image tag to ECR and capture the digest.
5. Set Terraform `container_image` to the approved immutable tag or digest.
6. Register new ECS task definitions for API, worker, and migration task using that image.
7. Run the migration as a one-off ECS task in private subnets only after explicit live-run approval.
8. Confirm the migration task exits successfully, emits expected CloudWatch logs, and has an acceptable stopped reason and container exit code.
9. Deploy the API service to the new task definition.
10. Deploy the worker service to the new task definition.
11. Verify `GET /health/ready` through the ALB.
12. Run the approval-gated smoke test against the deployed API base URL using
    [AWS deployed smoke test flow](aws-smoke-test-flow.md).
13. Watch API, worker, outbox, and webhook processing logs after rollout.

Migrations must run before service rollout when code expects the new schema.
Irreversible, destructive, revert, data-rewrite, or long-running migrations
require separate explicit production review before execution. A non-zero
migration exit code stops the API and worker rollout.

## CI/CD Path

Future CI/CD can extend the current GitHub Actions path without adding it in this phase:

- Keep typecheck, lint, tests, build, Docker image build, schema drift check, dependency audit, and forbidden wording scan as release gates.
- Current CI only builds the image locally as `transaction-event-gateway:ci`.
- After verification passes on an approved branch or tag, request explicit approval before AWS authentication or image publication.
- Publish the image to ECR with an immutable tag, such as the reviewed commit SHA, and record the digest.
- Set Terraform `container_image` through an approved non-secret input path.
- Register ECS task definitions with that image.
- Follow the documented one-off migration task flow and stop on failure.
- Update ECS services and wait for steady state.
- Run `/health/ready` and the documented deployed smoke verification after
  deployment.

Deployment credentials, registry authentication, image publication automation, and workflows are intentionally out of scope for the current Terraform scaffold.

## Rollback Strategy

Primary rollback:

- Roll the ECS API service back to the previous task definition or image digest.
- Roll the ECS worker service back to the matching previous task definition or image digest.
- Verify `/health/ready` and run the documented deployed smoke checks after
  rollback when the rollback environment is approved for smoke testing.

Migration caution:

- Rollback is straightforward only when the database schema remains backward-compatible.
- Irreversible migrations, destructive changes, enum removals, and large data rewrites require a reviewed production plan before deployment.
- Prefer expand-and-contract migration patterns for future changes: add compatible schema first, deploy code, backfill safely, then remove old schema in a later release.

Redis rollback note:

- Redis queue state is not authoritative. If worker rollback creates duplicate job delivery, PostgreSQL row locks and webhook idempotency should keep processing safe.

## Observability Minimum

MVP observability:

- CloudWatch log groups for API, worker, and migration tasks.
- Structured application logs with correlation IDs and safe identifiers.
- ALB and ECS health checks.
- API readiness via `GET /health/ready`.
- Approval-gated deployed smoke test using
  [AWS deployed smoke test flow](aws-smoke-test-flow.md). Keep it separate from
  the local Docker Compose smoke script unless a future phase approves reuse.
- Manual inspection of RDS state for outbox, webhook events, and processing attempts when diagnosing incidents.

Gaps to close after MVP:

- Metrics dashboards for HTTP latency, queue depth, outbox lag, job failures, and worker processing latency.
- Alerts for readiness failure, high 5xx rate, stuck outbox rows, failed webhook events, Redis unavailability, and database connection issues.
- Distributed tracing.
- Dead-letter inspection workflows.
- Longer retention and export policy for logs.

## Operational Risks and Gaps

- The current image default starts the API process; ECS worker and migration tasks need explicit command overrides.
- The current Terraform task definitions reference Secrets Manager placeholders for `DATABASE_URL`, `REDIS_URL`, and `WEBHOOK_SECRET`, but Terraform intentionally does not create secret versions or store their values.
- The Terraform backend/state decision is documented, but no remote backend is configured or enabled. First apply still requires an approved state owner and approved backend config outside git.
- The current Terraform ECS services are defined in private subnets with no public IPs. The scaffold defines the preferred VPC endpoint path for ECR API, ECR Docker, CloudWatch Logs, Secrets Manager, and S3-backed ECR layer access, but those endpoints are not live until approved VPC, subnet, private route table inputs, and apply approval are provided.
- The current Terraform ECS services still require execution of the documented ECR image publishing path, approved secret value population, endpoint input review, the documented migration task flow, and apply approval before they can serve production traffic.
- The migration task flow is documented, but the live one-off run still requires explicit approval, an approved `DATABASE_URL` secret value, the approved image reference, backend/state approval, and private egress inputs before first ECS execution.
- The deployed smoke test flow is documented, but the live run still requires
  an approved deployed API base URL, completed migration/API/worker rollout,
  approved non-production webhook values, and an approved evidence path before
  execution.
- `LOG_LEVEL` is a deployment design item, but current runtime support should be verified before using it as an operational control.
- Worker scaling should be conservative until production-like queue behavior and database lock contention are measured.
- ALB readiness depends on both PostgreSQL and Redis. This is strict and production-safe, but it means Redis incidents can remove API tasks from rotation even though some durable writes may still be possible.
- Manual retry operations exist conceptually in the runbook, but custom admin tooling is not part of this deployment MVP.
- Webhook secret rotation is not complete without application support for overlapping old and new secrets.
- The short-lived deploy runbook is documentation-only and has not been run.
  No formal automated deployment runbook or incident alert policy is
  implemented yet; the deployed smoke flow is also documentation-only and has
  not been run.

## Explicitly Not in MVP

- Kubernetes or EKS.
- Multi-region deployment.
- Blue/green deployment automation.
- Full observability stack with dashboards, alerts, tracing, and SLOs.
- Sophisticated autoscaling policies.
- Custom admin panel or manual retry UI.
- Blockchain provider integration beyond the current signed webhook contract.
- Autoscaling, app task roles, secret value population and rotation workflow, NAT Gateway implementation, and deployment workflow implementation in the current Terraform scaffold.
- AWS credentials, secrets, or live deployment changes.

## Handoff Checklist for Infrastructure Phase

- Review the current Terraform scaffold for ECR, security groups, ALB, private RDS PostgreSQL, private ElastiCache Redis, ECS task definitions, task log groups, ECS task execution IAM, and private VPC endpoint egress.
- Confirm the Terraform state owner and approved backend config before the first remote backend init or apply.
- Confirm approved existing VPC, private subnet, and private route table inputs before any apply that would create endpoint resources.
- Review the current ECS cluster, API service, worker service, and migration task Terraform definitions, then follow the documented one-off migration task flow when a live run is approved.
- Review ElastiCache Redis failover, Multi-AZ, TLS client settings, snapshots, and node sizing before production use.
- Configure TLS certificate, HTTPS listener, and production ALB hardening.
- Add least-privilege app task role permissions only if runtime AWS API access becomes necessary.
- Populate required Secrets Manager values after approval, including assembling `DATABASE_URL` from the RDS endpoint and AWS-managed PostgreSQL master user secret outside git.
- Add CI/CD only after design review, with migration and rollback gates.
- Review production migration expectations before first deployment, including the required result record from the one-off migration task flow.
- Review the deployed smoke test flow and result record before first API/worker
  rollout completion.
