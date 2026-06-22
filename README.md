# transaction-event-gateway

![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=nodedotjs&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-5.x-CB3837)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-IaC%20scaffold-844FBA?logo=terraform&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI-2088FF?logo=githubactions&logoColor=white)

Production-style NestJS backend for idempotent payment intents, signed webhook ingestion, PostgreSQL state, transactional outbox, BullMQ processing, and operational readiness.

## At A Glance

| Area | Current MVP |
| --- | --- |
| Runtime | Node.js 22, NestJS 11, TypeScript 5.9 |
| Processes | API process and worker process from the same codebase |
| Persistence | PostgreSQL 16, TypeORM migrations, durable idempotency, webhook inbox, outbox, and processing attempts |
| Queue | Redis 7 and BullMQ; jobs carry durable PostgreSQL IDs only |
| API | REST endpoints for payment intents and signed webhooks, Swagger UI, OpenAPI JSON, health endpoints |
| Reliability | PostgreSQL constraints, transactions, row locks, canonical request hashes, HMAC replay protection, transactional outbox |
| Observability | Structured logs, correlation IDs, liveness/readiness checks, smoke script, operational runbook |
| Testing | Typecheck, lint, Jest unit/e2e/worker coverage, build, local smoke flow |
| AWS status | Terraform scaffold defines core ECS/RDS/Redis/ALB shape for review; no live apply or deployment yet |

## Implemented Features

- Idempotent `POST /payment-intents` with `Idempotency-Key`, canonical request hashing, response snapshots, and conflict detection.
- Signed `POST /webhooks/blockchain` acceptance with timestamp tolerance, nonce replay protection, and HMAC validation over the raw request body.
- PostgreSQL schema and migrations for payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts.
- Transactional outbox between webhook acceptance and BullMQ publication.
- Separate worker process for outbox dispatch and idempotent webhook processing.
- Durable worker decisions through PostgreSQL row locks, state checks, and processing attempt records.
- Swagger/OpenAPI docs plus liveness and readiness endpoints.
- Structured request and application logging with correlation IDs.
- Local Docker Compose infrastructure, e2e coverage, worker/BullMQ coverage, and a repeatable smoke script.
- AWS Terraform scaffold for ECR, security groups, ALB, private RDS PostgreSQL, private ElastiCache Redis, ECS Fargate task definitions/services, task log groups, minimal ECS task execution IAM, and private VPC endpoint egress.

## Architecture

The service runs as two processes from the same codebase:

- **API process**: exposes REST endpoints, validates requests, verifies webhook signatures, writes durable state, and serves Swagger plus health endpoints.
- **Worker process**: runs the outbox dispatcher and BullMQ consumer for accepted webhook events.

PostgreSQL is the source of truth for payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts. Redis is queue infrastructure only; correctness does not depend on Redis locks, TTLs, or queue uniqueness.

Main reliability boundaries:

- Idempotency records protect `POST /payment-intents` with `(scope, idempotency_key)`, request hashes, and stored response snapshots.
- The webhook inbox stores signed provider events before asynchronous work starts.
- The transactional outbox stores durable work in the same transaction as webhook acceptance.
- BullMQ jobs contain only the durable `webhookEventId`.
- Worker processing reloads state from PostgreSQL, uses row locks, and is safe under duplicate jobs.
- Correlation IDs and structured logging are enabled for HTTP requests and error responses.
- `/health/live` reports process liveness; `/health/ready` checks configuration, PostgreSQL, and Redis.

Detailed documentation:

- [Architecture](docs/architecture.md): service topology, flows, state machines, transaction boundaries, and non-goals.
- [Domain state machine](docs/domain-state-machine.md): payment intent, webhook inbox, outbox, and worker lifecycle transitions.
- [API specification](docs/api.md): endpoint contracts, validation rules, error shapes, and OpenAPI expectations.
- [Database specification](docs/database.md): tables, enum types, constraints, migration order, and rollback notes.
- [Failure modes](docs/failure-modes.md): expected behavior for duplicate requests, webhook replays, queue failures, and worker crashes.
- [Testing strategy](docs/testing.md): unit, integration, e2e, worker, concurrency, and smoke coverage expectations.
- [Operational runbook](docs/runbook.md): health checks, database inspection, outbox diagnosis, worker troubleshooting, and local reset commands.
- [AWS deployment design](docs/aws-deployment-design.md): target AWS shape, release flow, observability minimum, and explicit gaps.
- [AWS deploy guardrails](docs/aws-deploy-guardrails.md): cost guardrails, first-deploy prerequisites, and teardown checklist before live AWS usage.
- [ECR image publishing path](docs/ecr-image-publishing.md): approval-gated future image selection, immutable tag/digest, and Terraform handoff rules.
- [One-off ECS migration task flow](docs/aws-migration-task-flow.md): approval-gated future migration task run order, stop conditions, and result record.
- [AWS deployed smoke test flow](docs/aws-smoke-test-flow.md): approval-gated future deployed API smoke checks, evidence policy, and result record.
- [AWS short-lived deploy runbook](docs/aws-short-lived-deploy-runbook.md): documentation-only preflight, approved order, required records, stop points, and teardown decision for a future short-lived AWS run.
- [Terraform scaffold notes](infra/terraform/README.md): current IaC scope, validation-only status, and approval-gated commands.
- [Implementation plan](docs/implementation-plan.md): phased implementation history and current documentation status.

## Screenshots

Swagger UI shows the generated OpenAPI surface exposed by the running service.

![Swagger UI](docs/assets/swagger-ui.png)

The readiness capture shows the API process validating configuration, PostgreSQL, and Redis.

![Readiness endpoint](docs/assets/health-ready.png)

The smoke capture shows a local webhook reaching processed webhook and published outbox state.

![Smoke outbox proof](docs/assets/smoke-outbox.png)

## AWS Terraform Status

The Terraform scaffold in `infra/terraform` implements ECR, security groups,
the MVP HTTP ALB path, a private RDS PostgreSQL instance, private ElastiCache
Redis, ECS Fargate task definitions, an ECS cluster, API and worker ECS
services, task log groups, the minimal ECS task execution role, and a
configurable private VPC endpoint egress path for ECR image pulls, CloudWatch
Logs, Secrets Manager runtime secrets, and S3-backed ECR layer access. It does
not define autoscaling, deployment workflows, NAT gateways, or live deployment
behavior.

The scaffold is for review and validation only. Do not run Terraform `plan`,
`apply`, or `destroy` against live AWS without explicit approval.
Review [AWS deploy guardrails](docs/aws-deploy-guardrails.md) before any live
AWS usage; budgets, billing notifications, region choice, deployment
prerequisites, and teardown ownership must be clear first.

Terraform backend/state handling is documented but not enabled. Local scaffold
validation remains `terraform init -backend=false`; no active backend block is
committed. A future remote backend should use an approved S3 state bucket with
encryption and an approved locking mechanism, with backend values supplied
through an ignored `infra/terraform/backend.hcl` file or an explicitly approved
command. Terraform state files and real backend values must not be committed.

The ECR image publishing path is documented but not executed. No image has
been published to ECR, no registry authentication is configured, and no deploy
workflow exists. Current CI only verifies the production image locally with
`docker build -t transaction-event-gateway:ci .`. A future deployment must use
an approved immutable tag or digest, never `latest`, and pass that approved
reference to Terraform through `container_image`.

The one-off ECS migration task flow is documented but not executed. The
Terraform scaffold defines a migration task definition that uses the same
approved image as the API and worker task definitions, runs
`npm run migration:run:prod`, and receives only `DATABASE_URL` as a secret.
No migration task has been run, and no task runner or deploy workflow exists.

The deployed smoke test flow is documented but not executed. It remains a
future approval-gated manual check after approved apply, image publication,
secret population, private egress, migration success, and API/worker rollout.
No deployed API base URL verification has occurred, and no live AWS smoke run
has occurred.

The short-lived deploy runbook is documented but not executed. It ties the
guardrails, backend/state decision, private egress inputs, secret population,
image approval, migration gate, API/worker rollout gate, deployed smoke gate,
monitoring window, and teardown decision into one future approval-gated order.
No short-lived AWS deploy has occurred.

RDS master credentials are managed by RDS with
`manage_master_user_password = true`; no database password value belongs in
Terraform files or tfvars files. The ECS task definitions now reference
Secrets Manager placeholders for `DATABASE_URL`, `REDIS_URL`, and
`WEBHOOK_SECRET`, but Terraform does not create secret versions or store those
values. A real deployment still needs approved secret population, with
`DATABASE_URL` assembled from the RDS endpoint and AWS-managed master user
secret outside git. The services run in private subnets with no public IPs; the
Terraform scaffold defines the preferred VPC endpoint path, but a real
deployment still needs approved VPC, subnet, and private route table inputs
plus explicit apply approval before those endpoints exist. A NAT Gateway remains
an explicit approval and cost-risk alternative, not the default path.

Before production use, review deletion protection, backup retention, final
snapshot behavior, Multi-AZ, storage sizing, Redis TLS/failover settings, and
the approval-gated migration task flow.

## Prerequisites

- Node.js 22.x, matching the Docker runtime image (`node:22-alpine`).
- npm.
- Docker and Docker Compose.
- PostgreSQL and Redis, normally started through `docker-compose.yml`.

## Environment

Configuration is validated at startup. Use `.env.example` as the local template.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode: `development`, `test`, or `production`. |
| `PORT` | API HTTP port. Defaults to `3000`. |
| `DATABASE_URL` | PostgreSQL connection URL. Required by API, worker, migrations, and tests. |
| `REDIS_URL` | Redis connection URL for BullMQ. Required by API readiness and worker processing. |
| `WEBHOOK_SECRET` | HMAC secret used to verify `POST /webhooks/blockchain`. Must be at least 16 characters. |
| `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` | Accepted webhook timestamp skew window. Defaults to `300`. |
| `OUTBOX_DISPATCH_ENABLED` | Enables the dispatcher runner in the worker process. Defaults to `true`. |
| `OUTBOX_DISPATCH_INTERVAL_MS` | Dispatcher polling interval in milliseconds. Defaults to `1000`. |

## Local Run

Install dependencies:

```bash
npm install
```

Start local infrastructure:

```bash
docker compose up -d postgres redis
```

Run migrations:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:show
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:revert
```

Production images run migrations from compiled JavaScript:

```bash
npm run build
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run:prod
```

Start the API in development mode:

```bash
npm run start:dev
```

Or build once and run the API and worker from `dist/` in separate terminals:

```bash
npm run build
npm run start
```

```bash
npm run start:worker
```

Swagger/OpenAPI:

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs/openapi.json`

Health endpoints:

- `GET http://localhost:3000/health/live`
- `GET http://localhost:3000/health/ready`

## API Examples

### Create a payment intent

First request:

```bash
curl -i http://localhost:3000/payment-intents \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pi-create-001' \
  -H 'X-Correlation-ID: local-create-001' \
  -d '{
    "amount": "125.50",
    "asset": "USDC",
    "destination": "wallet_test_123",
    "reference": "order-1001",
    "clientRequestId": "checkout-1001",
    "metadata": {
      "customerId": "cust_123"
    }
  }'
```

Expected response is `201 Created` with a payment intent body.

Idempotent replay with the same key and same logical payload:

```bash
curl -i http://localhost:3000/payment-intents \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pi-create-001' \
  -d '{
    "amount": "125.50",
    "asset": "USDC",
    "destination": "wallet_test_123",
    "reference": "order-1001",
    "clientRequestId": "checkout-1001",
    "metadata": {
      "customerId": "cust_123"
    }
  }'
```

Expected response is `200 OK` with `Idempotent-Replayed: true` and the stored response body.

Reusing the same `Idempotency-Key` with a different logical payload returns `409 Conflict` with `IDEMPOTENCY_CONFLICT` and does not mutate the original payment intent.

### Accept a signed webhook

The signature format is:

```text
signed_payload = timestamp + "." + nonce + "." + raw_request_body
signature = HMAC_SHA256(WEBHOOK_SECRET, signed_payload)
header = X-Webhook-Signature: v1=<hex_signature>
```

Generate a compact local request:

```bash
export WEBHOOK_SECRET='<WEBHOOK_SECRET>'
body='{"eventId":"evt_local_001","type":"transaction.confirmed","paymentIntentId":"<PAYMENT_INTENT_UUID>","txHash":"0xtest123","amount":"125.50","asset":"USDC"}'
timestamp="$(date +%s)"
nonce="nonce_${timestamp}"
signature="$(node -e 'const crypto = require("node:crypto"); const [secret, timestamp, nonce, body] = process.argv.slice(1); const hmac = crypto.createHmac("sha256", secret); hmac.update(timestamp); hmac.update("."); hmac.update(nonce); hmac.update("."); hmac.update(body); process.stdout.write(`v1=${hmac.digest("hex")}`);' "$WEBHOOK_SECRET" "$timestamp" "$nonce" "$body")"

curl -i http://localhost:3000/webhooks/blockchain \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $timestamp" \
  -H "X-Webhook-Nonce: $nonce" \
  -H "X-Webhook-Signature: $signature" \
  -d "$body"
```

Accepted response:

```json
{
  "eventId": "evt_local_001",
  "status": "ACCEPTED"
}
```

A duplicate webhook with the same event ID and payload returns `202 Accepted` with `ALREADY_ACCEPTED`.

## Worker and Outbox Behavior

Webhook acceptance writes a `webhook_events` inbox row and an `outbox_events` row only. It does not publish directly to BullMQ.

The worker process starts the dispatcher runner and the BullMQ consumer. The dispatcher selects pending or retryable outbox rows, publishes jobs to Redis/BullMQ, marks webhook events as `QUEUED`, and marks outbox rows as `PUBLISHED` after publication succeeds.

Dispatcher behavior is controlled by `OUTBOX_DISPATCH_ENABLED` and `OUTBOX_DISPATCH_INTERVAL_MS`. Jobs contain only `webhookEventId`, so duplicate publication or duplicate delivery is safe: the worker reloads the durable webhook event, locks rows in PostgreSQL, checks current status, and records processing attempts.

Operational troubleshooting notes are in `docs/runbook.md`.

## Reliability Highlights

- PostgreSQL is the authoritative store for payment state, idempotency, webhook inbox rows, outbox rows, and processing attempts.
- Redis/BullMQ is required for asynchronous progress, but not for durable correctness.
- `POST /payment-intents` is protected by a scoped idempotency key, canonical request hash, stored response snapshot, and PostgreSQL uniqueness.
- Webhook acceptance validates timestamp, nonce, and HMAC before persistence; invalid signatures and stale timestamps do not create inbox or outbox rows.
- Webhook inbox and outbox rows commit in the same PostgreSQL transaction, avoiding a database/queue dual-write gap.
- Outbox publication is at-least-once; duplicate BullMQ jobs are safe because the worker reloads durable rows and checks current state under row locks.
- Worker processing records sanitized attempts and leaves payment intent state unchanged on domain mismatches.
- Readiness checks required configuration, PostgreSQL, and Redis so degraded queue infrastructure is visible before accepting traffic in strict deployments.

## Observability

- Structured logs include correlation IDs, request metadata, safe entity identifiers, statuses, and error codes.
- `X-Correlation-ID` is accepted on inbound requests; missing values are generated and returned in responses.
- `/health/live` reports process liveness; `/health/ready` checks configuration, PostgreSQL, and Redis.
- Swagger UI and OpenAPI JSON are exposed at `/docs` and `/docs/openapi.json` for the implemented API surface.
- The smoke script exercises the full local path from health and OpenAPI through idempotency, signed webhook acceptance, outbox publication, worker processing, and final database state.
- `docs/runbook.md` contains local inspection queries for payment intents, webhook events, outbox rows, and processing attempts.
- `docs/aws-smoke-test-flow.md` documents the separate future deployed smoke flow; it is not a local smoke script and has not been run against AWS.
- Metrics dashboards, alerting, distributed tracing, and dead-letter inspection workflows are deferred.

## Testing and Verification

Current verification commands:

```bash
npm run typecheck
npm run lint
npm test
docker compose up -d postgres redis
npm run test:e2e
npm run build
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run typeorm -- schema:log
npm run smoke:local
```

E2E tests use the configured local PostgreSQL and Redis instances. The e2e global setup runs database migrations before the test suite starts.

### Local Smoke Check

Run the repeatable local smoke check after the API, worker, PostgreSQL, and Redis are already running:

```bash
docker compose up -d postgres redis
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
npm run build
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway REDIS_URL=redis://localhost:6379 WEBHOOK_SECRET=test-webhook-secret-value npm run start
```

In a separate terminal, start the worker with matching environment:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway REDIS_URL=redis://localhost:6379 WEBHOOK_SECRET=test-webhook-secret-value npm run start:worker
```

Then run:

```bash
npm run smoke:local
```

The smoke script checks health, OpenAPI, payment intent idempotency, signed webhook acceptance, duplicate webhook handling, signature and timestamp rejection, outbox publication, worker processing, and final PostgreSQL state. Set `SMOKE_BASE_URL` only for approved local or non-AWS test targets. Future deployed AWS smoke testing is documented separately in `docs/aws-smoke-test-flow.md` and must stay approval-gated.

## Failure Modes

- **Idempotency replay**: same key and same payload returns the stored response with `Idempotent-Replayed: true`.
- **Idempotency conflict**: same key and different payload returns `409 IDEMPOTENCY_CONFLICT`.
- **Invalid webhook signature**: returns `401 INVALID_WEBHOOK_SIGNATURE`; no inbox or outbox row is written.
- **Stale timestamp**: returns `408 STALE_WEBHOOK_TIMESTAMP`; no inbox or outbox row is written.
- **Duplicate webhook**: same provider event ID and same payload returns `202 ALREADY_ACCEPTED`.
- **Nonce replay**: reused nonce for a different event returns `409 WEBHOOK_NONCE_REPLAY`.
- **Redis unavailable**: payment intent creation and webhook acceptance can still persist durable state; dispatching and worker processing pause.
- **PostgreSQL unavailable**: durable API operations return `503 SERVICE_UNAVAILABLE`.
- **Queue publish failure**: the outbox row remains pending or retryable with backoff metadata.
- **Worker crash or retry**: PostgreSQL rollback and BullMQ retry preserve correctness; already processed events complete safely.
- **Unknown payment intent**: worker marks the webhook event `FAILED` with `UNKNOWN_PAYMENT_INTENT`.
- **Mismatch failures**: amount, asset, reference, terminal-state, or confirmed transaction hash conflicts fail the webhook without corrupting payment intent state.

## Project Status

MVP backend functionality is implemented locally: payment intent creation, idempotency, signed webhook acceptance, PostgreSQL schema and migrations, transactional outbox, BullMQ worker processing, structured logging, correlation IDs, and health/readiness endpoints.

Manual retry endpoint, metrics dashboards, authentication, authorization, and real provider integrations are intentional future extensions.

The AWS Terraform scaffold is implemented for structure review and validation,
and the ECR image publishing path, one-off ECS migration task flow, and deployed
smoke test flow are now documented. No image publication, one-off migration
run, deployed smoke test, remote Terraform backend enablement, secret value
population, Terraform apply, or live deployment has been completed.

## MVP Boundaries

This MVP does not provide custody, private key storage, wallet functionality, signing, real funds movement, or a real blockchain/provider integration. It does not include authentication, authorization, multitenancy, a manual retry API, admin UI, metrics dashboards, alerting, tracing, autoscaling, deployment automation, or a live AWS environment.

Terraform currently defines an infrastructure skeleton only. Real deployment
still requires approved backend configuration and state ownership, approved
secret value population, approved VPC/subnet/private route table inputs for the
private endpoint path, execution of the documented ECR image publishing path,
explicit approval for the documented one-off ECS migration task flow, cost and
durability review, and explicit approval before any live AWS operation.

## Repository Layout

```text
.
  README.md
  Dockerfile
  docker-compose.yml
  package.json
  .env.example
  docs/
    api.md
    architecture.md
    aws-deploy-guardrails.md
    aws-deployment-design.md
    aws-migration-task-flow.md
    aws-smoke-test-flow.md
    database.md
    ecr-image-publishing.md
    failure-modes.md
    implementation-plan.md
    runbook.md
    testing.md
  infra/terraform/
  migrations/
  scripts/
    smoke-local.sh
  src/
    common/
    config/
    database/
    health/
    outbox/
    payment-intents/
    processing/
    webhooks/
  test/
  .github/workflows/
```
