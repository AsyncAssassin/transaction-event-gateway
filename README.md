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
| AWS | Terraform scaffold for ECR, ALB, ECS Fargate, RDS PostgreSQL, and ElastiCache Redis; validated in CI, never applied |

## Implemented Features

- Idempotent `POST /payment-intents` with `Idempotency-Key`, canonical request hashing, response snapshots, and conflict detection.
- `GET /payment-intents/{id}` with the current status and the confirming transaction hash.
- Signed `POST /webhooks/blockchain` acceptance with timestamp tolerance, nonce replay protection, and HMAC validation over the raw request body.
- PostgreSQL schema and migrations for payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts.
- Transactional outbox between webhook acceptance and BullMQ publication.
- Separate worker process for outbox dispatch and idempotent webhook processing.
- Durable worker decisions through PostgreSQL row locks, state checks, and processing attempt records.
- Swagger/OpenAPI docs with request, response, and error schemas, plus liveness and readiness endpoints.
- Structured request and application logging with correlation IDs.
- Local Docker Compose infrastructure, e2e coverage, worker/BullMQ coverage, and a repeatable smoke script.
- AWS Terraform scaffold for ECR, security groups, ALB, private RDS PostgreSQL, private ElastiCache Redis, ECS Fargate task definitions/services, task log groups, minimal ECS task execution IAM, and private VPC endpoint egress.

## Architecture

The service runs as two processes from the same codebase:

- **API process**: exposes REST endpoints, validates requests, verifies webhook signatures, writes durable state, and serves Swagger plus health endpoints. It opens no BullMQ connection; only the `/health/ready` probe touches Redis.
- **Worker process**: runs the outbox dispatcher and BullMQ consumer for accepted webhook events.

PostgreSQL is the source of truth for payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts. Redis is queue infrastructure only; correctness does not depend on Redis locks, TTLs, or queue uniqueness.

Main reliability boundaries:

- Idempotency records protect `POST /payment-intents` with `(scope, idempotency_key)`, request hashes, and stored response snapshots.
- The webhook inbox stores signed provider events before asynchronous work starts.
- The transactional outbox stores durable work in the same transaction as webhook acceptance.
- BullMQ jobs contain only the durable `webhookEventId`.
- Worker processing reloads state from PostgreSQL, uses row locks, and is safe under duplicate jobs.
- Correlation IDs and structured logging are enabled for HTTP requests and error responses.
- `/health/live` reports process liveness; `/health/ready` checks configuration, PostgreSQL, and Redis; `/health/serving` checks configuration and PostgreSQL for load balancer routing.

Detailed documentation:

- [Architecture](docs/architecture.md): topology, request and processing flows, transaction boundaries, and design decisions.
- [Domain state machine](docs/domain-state-machine.md): payment intent, webhook inbox, outbox, and worker lifecycle transitions.
- [API specification](docs/api.md): endpoint contracts, validation rules, error shapes, and OpenAPI notes.
- [Database specification](docs/database.md): tables, enum types, constraints, migration order, and rollback notes.
- [Failure modes](docs/failure-modes.md): behavior under duplicate requests, webhook replays, queue and database failures, and known limitations.
- [Testing](docs/testing.md): unit and e2e suites, CI checks, and the local smoke script.
- [Operational runbook](docs/runbook.md): health checks, database inspection, outbox and worker diagnosis, and local reset commands.
- [AWS deployment design](docs/aws-deployment-design.md): target AWS shape, decisions, release and rollback, and known gaps before a first apply.
- [AWS deployment runbook](docs/aws-deployment-runbook.md): prerequisites, image publishing, migrations, deployed smoke checks, and teardown for a first short-lived deployment.
- [Terraform scaffold](infra/terraform/README.md): resources, variables, validation commands, and the `DATABASE_URL` secret format.

## Screenshots

Swagger UI shows the operations of the running service and the request, response, and error schemas of its generated OpenAPI document.

![Swagger UI](docs/assets/swagger-ui.png)

The readiness capture shows the API process validating configuration, PostgreSQL, and Redis.

![Readiness endpoint](docs/assets/health-ready.png)

The smoke capture shows real `smoke:local` output against the Docker Compose stack, followed by a database query confirming that the payment intent, webhook event, and outbox row reached `CONFIRMED`, `PROCESSED`, and `PUBLISHED`.

![Smoke outbox proof](docs/assets/smoke-outbox.png)

## AWS Terraform Status

`infra/terraform` defines ECR, security groups, an HTTP ALB, private RDS PostgreSQL, private ElastiCache Redis, ECS Fargate task definitions and services for the API and worker, a one-off migration task definition, task log groups, the task execution role, Secrets Manager placeholders for runtime secrets, and VPC endpoints for private egress. CI runs `terraform fmt -check` and `terraform validate`; the scaffold has never been applied, and no image, secret value, or remote state exists.

Some gaps must be closed before a first apply, such as a currently available RDS engine version, a migration step that runs before the services roll out, and a Redis parameter group with `noeviction`. They are listed in [known gaps before the first apply](docs/aws-deployment-design.md#known-gaps-before-the-first-apply); the procedure for a short-lived deployment is in the [AWS deployment runbook](docs/aws-deployment-runbook.md).

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
| `REDIS_URL` | Redis connection URL for BullMQ and full readiness. Required by worker processing. |
| `WEBHOOK_SECRET` | HMAC secret used to verify `POST /webhooks/blockchain`. Must be at least 16 characters. |
| `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` | Accepted webhook timestamp skew window. Defaults to `300`. |
| `OUTBOX_DISPATCH_ENABLED` | Enables the dispatcher runner in the worker process. Defaults to `true`. |
| `OUTBOX_DISPATCH_INTERVAL_MS` | Dispatcher polling interval in milliseconds. Defaults to `1000`. |
| `OUTBOX_MAX_ATTEMPTS` | Reserved/deprecated from earlier bounded retry behavior. Transient outbox publish failures retry indefinitely with capped backoff; do not rely on this to limit Redis outage retries. Defaults to `10` while the runtime still accepts it. |
| `RATE_LIMIT_ENABLED` | Enables process-local, in-memory request rate limiting on each API instance. Defaults to `true`. |
| `RATE_LIMIT_TTL_SECONDS` | Rate limit window in seconds. Defaults to `60`. |
| `RATE_LIMIT_LIMIT` | Max requests per window per observed request source as seen by Nest/Express. Local/direct deployments use the request IP. Behind ALB/proxy, this is not guaranteed to be the real end-client IP until explicit trust proxy / `X-Forwarded-For` handling is implemented. Defaults to `100`. |
| `SWAGGER_ENABLED` | In `production`, serves Swagger/OpenAPI only when `true`. Non-production always serves it. Defaults to `false`. |

## Local Run

Install dependencies:

```bash
npm install
```

Create the local environment file; the API, worker, and migration commands read `.env` (variables set in the shell take precedence):

```bash
cp .env.example .env
```

Start local infrastructure:

```bash
docker compose up -d postgres redis
```

Run migrations and show their status:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:show
```

Roll back the most recent migration only when you intend to undo it; the API and worker need the full schema, so run `migration:run` again before starting them:

```bash
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
- `GET http://localhost:3000/health/ready` (config, PostgreSQL, Redis; for operators and deploy gates)
- `GET http://localhost:3000/health/serving` (config and PostgreSQL only; load balancer target)

### Full Stack With Docker Compose

`docker compose up` builds the image once and starts everything in order: PostgreSQL and Redis with health checks, a one-shot `migrate` service that runs `npm run migration:run:prod` and exits, then the API and worker, which start only after the migration finished successfully:

```bash
docker compose up --build
```

The API listens on `http://localhost:3000`; the API and worker restart automatically unless stopped. Compose publishes the API, PostgreSQL, and Redis ports on `127.0.0.1` only. The Compose services, `.env.example`, and the smoke script share the local webhook secret `local-development-placeholder-secret`, so the smoke check needs no extra variables:

```bash
npm run smoke:local
```

Stop the containerized API and worker with `docker compose stop api worker` before running them from `dist/` on the same port.

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
export WEBHOOK_SECRET=local-development-placeholder-secret
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

### Read a payment intent

Once the worker has processed the webhook, the payment intent shows the confirmation:

```bash
curl -i http://localhost:3000/payment-intents/<PAYMENT_INTENT_UUID>
```

```json
{
  "id": "<PAYMENT_INTENT_UUID>",
  "status": "CONFIRMED",
  "amount": "125.5",
  "asset": "USDC",
  "destination": "wallet_test_123",
  "reference": "order-1001",
  "clientRequestId": "checkout-1001",
  "confirmedTxHash": "0xtest123",
  "createdAt": "2026-09-23T10:00:00.000Z",
  "updatedAt": "2026-09-23T10:00:02.000Z"
}
```

`POST /payment-intents` returns the same fields, with `status` `CREATED` and `confirmedTxHash` `null`. Amounts come back in canonical form, so `"125.50"` is returned as `"125.5"`. An unknown ID returns `404 NOT_FOUND`.

## Worker and Outbox Behavior

Webhook acceptance writes a `webhook_events` inbox row and an `outbox_events` row only. It does not publish directly to BullMQ.

The worker process starts the dispatcher runner and the BullMQ consumer. The dispatcher selects pending or retryable outbox rows, publishes jobs to Redis/BullMQ, marks webhook events as `QUEUED`, and marks outbox rows as `PUBLISHED` after publication succeeds.

Transient Redis, BullMQ, or publisher failures leave the accepted webhook durable in PostgreSQL. The outbox row becomes or remains `FAILED` with incremented `attempts`, sanitized `last_error`, capped `next_attempt_at`, and `dead_at = null`; the dispatcher retries indefinitely while the dependency is unavailable. Deterministic poison payloads, such as a missing or non-string `webhookEventId`, are non-retryable and are marked `FAILED` with `dead_at` set. If the BullMQ `Queue` object is poisoned, the publisher recreates it and retries the publish once before returning a transient failure to the outbox.

A published job can still be lost, for example with Redis data or after all five BullMQ attempts fail during a PostgreSQL outage. Every 60 seconds the worker hands outbox rows that were published more than 10 minutes ago, and whose webhook event has not finished, back to the dispatcher, which publishes them again; see [failure modes](docs/failure-modes.md#webhook-job-lost-or-retries-exhausted).

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
- `/health/ready` checks configuration, PostgreSQL through an isolated bounded health pool, and Redis through an independent probe for operators and deploy gates. `/health/serving` checks configuration and the isolated PostgreSQL health pool only and is the load balancer health-check target, so a Redis incident does not remove API tasks that can still accept payment intents and webhooks.

## Observability

- Structured logs include correlation IDs, request metadata, safe entity identifiers, statuses, and error codes. 5xx responses and worker failures also log the error name, a safe cause code such as a SQLSTATE or errno, and the top stack frames, never the raw error message.
- `X-Correlation-ID` is accepted on inbound requests; missing values are generated and returned in responses.
- `/health/live` reports process liveness; `/health/ready` checks configuration, PostgreSQL, and Redis. `/health/serving` excludes Redis for load balancer serving readiness.
- Swagger UI and OpenAPI JSON are exposed at `/docs` and `/docs/openapi.json` for the implemented API surface.
- The smoke script exercises the full local path from health and OpenAPI through idempotency, signed webhook acceptance, outbox publication, worker processing, and final database state.
- `docs/runbook.md` contains local inspection queries for payment intents, webhook events, outbox rows, and processing attempts.
- Metrics dashboards, alerting, distributed tracing, and dead-letter inspection workflows are deferred.

## Testing and Verification

Current verification commands:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
docker compose stop api worker
docker compose up -d postgres redis
npm run test:e2e
npm run build
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway bash scripts/check-schema-drift.sh
```

E2E tests use the configured local PostgreSQL and Redis instances, and the e2e global setup runs database migrations first. Stop the Compose `api` and `worker` services before `npm run test:e2e`: the suite truncates the tables of the local database, and its global setup refuses to start while another BullMQ worker is consuming the queue. The smoke check below needs a running stack.

Dependabot opens grouped weekly pull requests for npm dependencies and GitHub Actions (`.github/dependabot.yml`); NestJS packages are grouped so they always move together, and major versions are upgraded manually.

### Local Smoke Check

Run the repeatable local smoke check after the API, worker, PostgreSQL, and Redis are already running:

```bash
docker compose up -d postgres redis
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
npm run build
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway REDIS_URL=redis://localhost:6379 WEBHOOK_SECRET=local-development-placeholder-secret npm run start
```

In a separate terminal, start the worker with matching environment:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway REDIS_URL=redis://localhost:6379 WEBHOOK_SECRET=local-development-placeholder-secret npm run start:worker
```

Then run:

```bash
npm run smoke:local
```

The smoke script checks health, OpenAPI, payment intent idempotency, signed webhook acceptance, duplicate webhook handling, signature and timestamp rejection, outbox publication, worker processing, final PostgreSQL state, and the confirmed payment intent returned by `GET /payment-intents/{id}`. It reads PostgreSQL and Redis through the local Compose containers, so `SMOKE_BASE_URL` can point it at another local API but not at a deployed one; deployed checks are in the [AWS deployment runbook](docs/aws-deployment-runbook.md).

## Failure Modes

- **Idempotency replay**: same key and same payload returns the stored response with `Idempotent-Replayed: true`.
- **Idempotency conflict**: same key and different payload returns `409 IDEMPOTENCY_CONFLICT`.
- **Invalid webhook signature**: returns `401 INVALID_WEBHOOK_SIGNATURE`; no inbox or outbox row is written.
- **Stale timestamp**: returns `400 STALE_WEBHOOK_TIMESTAMP`; no inbox or outbox row is written.
- **Malformed body**: NUL and other control characters, unpaired surrogates, nesting deeper than 32 levels, and keys such as `__proto__` return `400 VALIDATION_ERROR` before routing and before the signature check.
- **Rate limit exceeded**: more than `RATE_LIMIT_LIMIT` requests to one route from one client address within `RATE_LIMIT_TTL_SECONDS` return `429 RATE_LIMITED` with `Retry-After`; health endpoints are not limited.
- **Duplicate webhook**: same provider event ID and same payload returns `202 ALREADY_ACCEPTED`.
- **Nonce replay**: reused nonce for a different event returns `409 WEBHOOK_NONCE_REPLAY`.
- **Redis unavailable**: payment intent creation and webhook acceptance can still persist durable state; `/health/ready` returns unavailable, `/health/serving` can remain healthy when configuration and PostgreSQL are healthy, and dispatching/worker processing waits and retries.
- **PostgreSQL unreachable**: when connections are refused or dropped, durable API operations return `503 SERVICE_UNAVAILABLE`. A PostgreSQL that accepts connections but stops answering is not detected quickly; see [known limitations](docs/failure-modes.md#known-limitations).
- **Queue publish failure**: the outbox row remains `FAILED` and retryable with attempts, sanitized error text, capped backoff metadata, and no `dead_at` for transient failures.
- **Worker crash or retry**: PostgreSQL rollback and BullMQ retry preserve correctness; already processed events complete safely.
- **Lost or exhausted job**: a webhook event still `QUEUED` 10 minutes after its job was published is published again by the worker's outbox reconciliation.
- **Unknown payment intent**: worker marks the webhook event `FAILED` with `UNKNOWN_PAYMENT_INTENT`.
- **Mismatch failures**: amount, asset, terminal-state, or confirmed transaction hash conflicts fail the webhook without corrupting payment intent state.

## Project Status

MVP backend functionality is implemented locally: payment intent creation and reads, idempotency, signed webhook acceptance, PostgreSQL schema and migrations, transactional outbox, BullMQ worker processing, structured logging, correlation IDs, and health/readiness endpoints.

Manual retry endpoint, metrics dashboards, authentication, authorization, and real provider integrations are intentional future extensions.

The AWS Terraform scaffold is validated in CI but has never been applied; see [AWS Terraform Status](#aws-terraform-status).

## MVP Boundaries

This MVP does not provide custody, private key storage, wallet functionality, signing, real funds movement, or a real blockchain/provider integration. It does not include authentication, authorization, multitenancy, a manual retry API, admin UI, metrics dashboards, alerting, tracing, autoscaling, deployment automation, or a live AWS environment.

Public endpoints enforce a request body size limit and process-local, in-memory rate limiting based on the request source observed by Nest/Express. Local or direct deployments use the request IP; behind ALB/proxy, the observed source may be the ALB/proxy or another shared source. The current MVP does not implement trust proxy / `X-Forwarded-For` handling or a distributed/shared limiter, so accurate per-client IP limiting across ECS tasks is a production traffic prerequisite or known limitation. A retention or cleanup job for the durable tables is also deferred: the tables grow until a future retention policy is added. `idempotency_records.expires_at` is populated so that future cleanup has data to act on, but no cleanup runs yet.

Terraform defines the infrastructure but no deployment pipeline: images, secret values, remote state, and the migration run are manual steps described in the [AWS deployment runbook](docs/aws-deployment-runbook.md).

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
    aws-deployment-runbook.md
    database.md
    domain-state-machine.md
    failure-modes.md
    runbook.md
    testing.md
  infra/terraform/
  migrations/
  scripts/
    check-schema-drift.sh
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
