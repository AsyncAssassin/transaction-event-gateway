# transaction-event-gateway

![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=nodedotjs&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
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
| Runtime | Node.js 22, NestJS 11, TypeScript 5.8 |
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
- AWS Terraform scaffold for ECR, security groups, ALB, private RDS PostgreSQL, private ElastiCache Redis, ECS Fargate task definitions/services, task log groups, and minimal ECS task execution IAM.

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
- [Terraform scaffold notes](infra/terraform/README.md): current IaC scope, validation-only status, and approval-gated commands.
- [Implementation plan](docs/implementation-plan.md): phased implementation history and current documentation status.

## AWS Terraform Status

The Terraform scaffold in `infra/terraform` implements ECR, security groups,
the MVP HTTP ALB path, a private RDS PostgreSQL instance, private ElastiCache
Redis, ECS Fargate task definitions, an ECS cluster, API and worker ECS
services, task log groups, and the minimal ECS task execution role. It does not
define autoscaling, deployment workflows, private egress infrastructure, or
runtime secrets wiring.

The scaffold is for review and validation only. Do not run Terraform `plan`,
`apply`, or `destroy` against live AWS without explicit approval.

RDS master credentials are managed by RDS with
`manage_master_user_password = true`; no database password value belongs in
Terraform files or tfvars files. A later ECS/secrets phase must retrieve the
AWS-managed secret and wire `DATABASE_URL` for the API, worker, and migrations.
The ECS task definitions and services also intentionally omit `REDIS_URL` and
`WEBHOOK_SECRET` until approved secret sources are added. The services run in
private subnets with no public IPs, so a real deployment also needs NAT or VPC
endpoints for ECR, CloudWatch Logs, and later secrets access before tasks can
reliably start.

Before production use, review deletion protection, backup retention, final
snapshot behavior, Multi-AZ, storage sizing, Redis TLS/failover settings, and
the migration execution strategy.

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

The smoke script checks health, OpenAPI, payment intent idempotency, signed webhook acceptance, duplicate webhook handling, signature and timestamp rejection, outbox publication, worker processing, and final PostgreSQL state. Set `SMOKE_BASE_URL` to target a non-default API URL.

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

The AWS Terraform scaffold is implemented for structure review and validation, but no image push, secrets wiring, private egress path, Terraform apply, or live deployment has been completed.

## MVP Boundaries

This MVP does not provide custody, private key storage, wallet functionality, signing, real funds movement, or a real blockchain/provider integration. It does not include authentication, authorization, multitenancy, a manual retry API, admin UI, metrics dashboards, alerting, tracing, autoscaling, deployment automation, or a live AWS environment.

Terraform currently defines an infrastructure skeleton only. Real deployment still requires approved secrets/environment wiring, private egress for ECS tasks, an image push path, migration execution strategy, cost and durability review, and explicit approval before any live AWS operation.

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
    aws-deployment-design.md
    database.md
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
