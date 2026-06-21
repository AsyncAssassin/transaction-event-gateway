# AWS Deployment Design

## Metadata

| Field | Value |
| --- | --- |
| Status | Design only |
| Scope | MVP AWS deployment architecture |
| Last updated | 2026-06-21 |

## Scope

This document describes a recommended MVP AWS deployment shape for `transaction-event-gateway`. It is a handoff document for a later infrastructure phase.

This phase does not implement infrastructure, change application code, change Docker behavior, add deployment workflows, or deploy anything.

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
  -> build and verify Docker image
  -> push image to ECR
  -> run one-off migration task
  -> roll ECS API and worker services
```

Core AWS services:

- **ECR** stores versioned application images produced from the existing Dockerfile.
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

## Runtime Units

### API Service

- ECS service: `transaction-event-gateway-api`.
- Image: latest approved image digest or immutable tag from ECR.
- Command: default image command, currently the API process.
- Desired count: start with at least 2 tasks for production-like availability; staging may use 1.
- Inbound: ALB target group only.
- Health check: ALB target group should use `GET /health/ready` so traffic reaches only tasks with required config, PostgreSQL, and Redis connectivity.
- Public endpoints: REST API, Swagger, and health endpoints through the ALB.

### Worker Service

- ECS service: `transaction-event-gateway-worker`.
- Image: same image digest or immutable tag as the API release.
- Command override: run the worker entrypoint, for example `node dist/worker.js`.
- Desired count: start with 1 for MVP; increase only after queue depth, lock behavior, and processing latency are observed.
- Inbound: none.
- Outbound: PostgreSQL, Redis, CloudWatch Logs, and AWS APIs needed for secrets.
- Dispatcher: enabled with `OUTBOX_DISPATCH_ENABLED=true` unless a controlled maintenance window requires pausing publication.

### Migration Task

- ECS one-off task: uses the same image version as the release.
- Command override: run database migrations before rolling API and worker services, for example `npm run migration:run`.
- Network: private subnets with access to RDS and secrets.
- Execution: must finish successfully before service rollout proceeds.
- Safety: production migrations require review for lock behavior, runtime duration, and rollback limits.

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
- ECS tasks reach ECR, CloudWatch Logs, and Secrets Manager or SSM through NAT or VPC endpoints.
- RDS and Redis have no public endpoint.

Security group model:

- **ALB security group**: inbound `443` from allowed public clients; outbound only to the API service port.
- **API task security group**: inbound API port only from the ALB security group; outbound to RDS, Redis, and required AWS service endpoints.
- **Worker task security group**: no inbound rules; outbound to RDS, Redis, and required AWS service endpoints.
- **RDS security group**: inbound PostgreSQL port only from API and worker task security groups.
- **Redis security group**: inbound Redis port only from API and worker task security groups.

IAM model:

- ECS task execution role can pull from ECR, write CloudWatch logs, and fetch configured secrets.
- Application task role should be minimal. At MVP, it may only need read access to the specific secrets or parameters if they are loaded at runtime by ECS.
- CI/CD role can push to the specific ECR repository and update the specific ECS services, but should not have broad administrator access.

## Migration and Release Flow

Recommended release order:

1. Build the Docker image from the repository state selected for release.
2. Run existing verification, including image build verification.
3. Push the immutable image tag or digest to ECR.
4. Register new ECS task definitions for API, worker, and migration task using that image.
5. Run the migration as a one-off ECS task in private subnets.
6. Confirm the migration task exits successfully and emits expected CloudWatch logs.
7. Deploy the API service to the new task definition.
8. Deploy the worker service to the new task definition.
9. Verify `GET /health/ready` through the ALB.
10. Run the smoke test against the deployed API base URL.
11. Watch API, worker, outbox, and webhook processing logs after rollout.

Migrations must run before service rollout when code expects the new schema. Irreversible or long-running migrations require explicit production review before execution.

## CI/CD Path

Future CI/CD can extend the current GitHub Actions path without adding it in this phase:

- Keep typecheck, lint, tests, build, Docker image build, schema drift check, dependency audit, and forbidden wording scan as release gates.
- After verification passes on an approved branch or tag, authenticate to AWS using OIDC.
- Push the image to ECR with an immutable tag, such as commit SHA.
- Register ECS task definitions with that image.
- Run the one-off migration task and stop on failure.
- Update ECS services and wait for steady state.
- Run `/health/ready` and smoke verification after deployment.

Deployment credentials and workflows are intentionally out of scope for this docs-only phase.

## Rollback Strategy

Primary rollback:

- Roll the ECS API service back to the previous task definition or image digest.
- Roll the ECS worker service back to the matching previous task definition or image digest.
- Verify `/health/ready` and run smoke checks after rollback.

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
- Post-deploy smoke test using the existing smoke script with a deployed base URL.
- Manual inspection of RDS state for outbox, webhook events, and processing attempts when diagnosing incidents.

Gaps to close after MVP:

- Metrics dashboards for HTTP latency, queue depth, outbox lag, job failures, and worker processing latency.
- Alerts for readiness failure, high 5xx rate, stuck outbox rows, failed webhook events, Redis unavailability, and database connection issues.
- Distributed tracing.
- Dead-letter inspection workflows.
- Longer retention and export policy for logs.

## Operational Risks and Gaps

- The current image default starts the API process; ECS worker and migration tasks need explicit command overrides.
- `LOG_LEVEL` is a deployment design item, but current runtime support should be verified before using it as an operational control.
- Worker scaling should be conservative until production-like queue behavior and database lock contention are measured.
- ALB readiness depends on both PostgreSQL and Redis. This is strict and production-safe, but it means Redis incidents can remove API tasks from rotation even though some durable writes may still be possible.
- Manual retry operations exist conceptually in the runbook, but custom admin tooling is not part of this deployment MVP.
- Webhook secret rotation is not complete without application support for overlapping old and new secrets.
- No formal deployment runbook or incident alert policy is implemented yet.

## Explicitly Not in MVP

- Kubernetes or EKS.
- Multi-region deployment.
- Blue/green deployment automation.
- Full observability stack with dashboards, alerts, tracing, and SLOs.
- Sophisticated autoscaling policies.
- Custom admin panel or manual retry UI.
- Blockchain provider integration beyond the current signed webhook contract.
- Terraform, CDK, CloudFormation, or any infrastructure implementation in this phase.
- AWS credentials, secrets, or live deployment changes.

## Handoff Checklist for Infrastructure Phase

- Create ECR repository and immutable image tagging policy.
- Define ECS cluster, API service, worker service, and migration task definition.
- Provision RDS PostgreSQL and ElastiCache Redis in private subnets.
- Configure ALB, target group, TLS certificate, and `/health/ready` health check.
- Define least-privilege security groups and IAM roles.
- Store required environment values in Secrets Manager or SSM Parameter Store.
- Add CI/CD only after design review, with migration and rollback gates.
- Document production migration review expectations before first deployment.
