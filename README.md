# transaction-event-gateway

Production-style NestJS backend for idempotent payment intents, signed webhook ingestion, PostgreSQL state, transactional outbox, BullMQ processing, and operational readiness.

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

AWS deployment design for future deployment phases: `docs/aws-deployment-design.md`.

## AWS Terraform Scaffold

The current Terraform scaffold in `infra/terraform` implements ECR, security
groups, the MVP HTTP ALB path, a private RDS PostgreSQL instance, private
ElastiCache Redis, ECS Fargate task definitions, an ECS cluster, API and worker
ECS services, task log groups, and the minimal ECS task execution role. It does
not define autoscaling, deployment workflows, or secrets wiring.

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
