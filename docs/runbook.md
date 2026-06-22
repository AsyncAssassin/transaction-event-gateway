# Operational Runbook

## Purpose

This runbook covers local and staging-style operation for `transaction-event-gateway`: health checks, state inspection, outbox and worker diagnosis, safe local resets, and log correlation. PostgreSQL is the source of truth; Redis/BullMQ is queue infrastructure. Future deployed AWS smoke testing is documented separately in [AWS deployed smoke test flow](aws-smoke-test-flow.md) and remains approval-gated.

## Service Topology

- **API process**: serves REST endpoints, validates payment intent requests, verifies signed webhooks, writes durable PostgreSQL state, and exposes Swagger plus health endpoints.
- **Worker process**: runs separately from the API and owns BullMQ consumption plus the outbox dispatcher runner.
- **PostgreSQL**: stores payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts.
- **Redis/BullMQ**: stores queue state for asynchronous webhook processing. It is required for progress, not correctness.
- **Outbox dispatcher runner**: runs inside the worker process when `OUTBOX_DISPATCH_ENABLED=true`, polling eligible outbox rows every `OUTBOX_DISPATCH_INTERVAL_MS`.
- **Health endpoints**: `/health/live` checks process liveness; `/health/ready` checks configuration, PostgreSQL, and Redis.

## Quick Health Checks

```bash
curl -i http://localhost:3000/health/live
curl -i http://localhost:3000/health/ready
docker compose ps
npm run smoke:local
```

Healthy results:

- `/health/live` returns `200` with `status: "ok"`.
- `/health/ready` returns `200` with `checks.config`, `checks.postgres`, and `checks.redis` all `ok`.
- `docker compose ps` shows PostgreSQL and Redis running and healthy.
- `npm run smoke:local` passes after PostgreSQL, Redis, the API process, and the worker process are running with matching local environment.

Do not use the local smoke command as a deployed AWS smoke test unless a future
approved phase explicitly allows that target and its data, credential, and
evidence boundaries.

## Database Inspection

All commands below target the local Docker Compose PostgreSQL service.

Recent payment intents:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, status, amount, asset, reference, client_request_id, confirmed_tx_hash, failure_reason, created_at, updated_at FROM payment_intents ORDER BY created_at DESC LIMIT 20;"
```

Recent webhook events:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, provider, external_event_id, event_type, payment_intent_id, tx_hash, status, failure_reason, received_at, processed_at FROM webhook_events ORDER BY received_at DESC LIMIT 20;"
```

Pending or failed outbox rows:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, type, aggregate_type, aggregate_id, status, attempts, next_attempt_at, last_error, created_at, published_at FROM outbox_events WHERE status IN ('PENDING', 'FAILED') ORDER BY created_at ASC LIMIT 50;"
```

Processing attempts:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, webhook_event_id, job_id, status, error_message, started_at, finished_at, created_at FROM webhook_processing_attempts ORDER BY created_at DESC LIMIT 50;"
```

Stuck outbox rows:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, aggregate_id, status, attempts, next_attempt_at, last_error, created_at FROM outbox_events WHERE (status = 'PENDING' AND created_at < now() - interval '2 minutes') OR (status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())) ORDER BY created_at ASC LIMIT 50;"
```

Failed webhook events:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, external_event_id, payment_intent_id, tx_hash, failure_reason, processed_at FROM webhook_events WHERE status = 'FAILED' ORDER BY processed_at DESC LIMIT 50;"
```

Confirmed payment intents by transaction hash:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, status, amount, asset, reference, confirmed_tx_hash, updated_at FROM payment_intents WHERE confirmed_tx_hash = '<tx_hash>';"
```

## Outbox Troubleshooting

Outbox statuses:

- `PENDING`: accepted webhook work is durable but has not been published to BullMQ yet.
- `PUBLISHED`: dispatcher published the BullMQ job and marked the outbox row complete.
- `FAILED`: dispatcher attempted publication and stored retry metadata.

Retry metadata:

- `attempts`: number of failed publish attempts recorded for the outbox row.
- `next_attempt_at`: earliest time a failed row is eligible for another dispatch.
- `last_error`: sanitized dispatch failure reason.

If outbox rows are stuck:

- Confirm the worker process is running; the dispatcher runs in the worker, not the API.
- Confirm `OUTBOX_DISPATCH_ENABLED` is not disabled.
- Confirm Redis is reachable from the worker.
- Check `next_attempt_at` for failed rows that are waiting for backoff.
- Check worker logs for `outbox_dispatch_failed` or `outbox_dispatch_runner_failed`.
- Remember webhook acceptance writes `webhook_events` and `outbox_events`; it does not publish directly to BullMQ.

## Worker Troubleshooting

The worker must run separately from the API:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway REDIS_URL=redis://localhost:6379 WEBHOOK_SECRET=test-webhook-secret-value npm run start:worker
```

Worker jobs contain only `webhookEventId`, so the worker reloads durable state from PostgreSQL. Duplicate jobs should be safe because processing locks the webhook row and exits successfully if the event is already `PROCESSED`.

If `webhook_events.status` stays `QUEUED` or `PROCESSING`:

- Check that Redis is reachable and the worker process is consuming jobs.
- Inspect `webhook_processing_attempts` for recent entries tied to the webhook event.
- Inspect worker logs by `webhookEventId` and `jobId`.
- Check whether the process stopped while an event was in flight; BullMQ should retry and PostgreSQL transaction rollback should prevent partial state.

If `webhook_events.status` becomes `FAILED`:

- Read `webhook_events.failure_reason`.
- Read the latest `webhook_processing_attempts.error_message`.
- Compare the webhook payload against the referenced `payment_intents` row for amount, asset, reference, current status, and transaction hash.

## Webhook Failure Reasons

- `UNKNOWN_PAYMENT_INTENT`: the webhook references a payment intent ID that does not exist.
- `UNSUPPORTED_EVENT_TYPE`: the worker received an event type it does not process.
- `MISSING_TX_HASH`: a confirmed transaction event did not include a usable transaction hash.
- `AMOUNT_MISMATCH`: webhook amount does not match the payment intent amount.
- `ASSET_MISMATCH`: webhook asset does not match the payment intent asset.
- `REFERENCE_MISMATCH`: webhook reference was present and did not match the payment intent reference.
- `PAYMENT_INTENT_TERMINAL`: the payment intent is already terminal or confirmed with a different transaction hash.
- `CONFIRMED_TX_HASH_CONFLICT`: the transaction hash is already attached to another payment intent.

## Redis Unavailable

- `/health/ready` should return unavailable because Redis readiness fails.
- Payment intent creation and webhook acceptance are PostgreSQL-backed for correctness.
- Outbox dispatch and worker processing cannot progress until Redis recovers.
- After Redis returns, the worker dispatcher should resume publishing eligible outbox rows and BullMQ processing should continue.

## PostgreSQL Unavailable

- Durable API operations should fail because idempotency, webhook inbox, outbox, and payment state require PostgreSQL.
- The service must not fall back to Redis or memory for correctness.
- `/health/ready` should return unavailable because PostgreSQL readiness fails.
- Migrations and schema checks require PostgreSQL.

## Safe Local Reset Commands

These commands are destructive and local-only. Do not run them against shared or production databases.

Truncate operational tables in dependency-safe order:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "TRUNCATE TABLE webhook_processing_attempts, outbox_events, webhook_events, idempotency_records, payment_intents RESTART IDENTITY CASCADE;"
```

Prefer smoke IDs for targeted inspection instead of queue deletion:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, status, reference, confirmed_tx_hash FROM payment_intents WHERE reference LIKE 'order_smoke_%' ORDER BY created_at DESC LIMIT 20;"
```

For a full local infrastructure restart:

```bash
docker compose down
docker compose up -d postgres redis
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
```

If local Redis queue state is suspected, prefer restarting the local Redis container after stopping API and worker processes. There is no application-level queue cleanup command in `package.json`.

## Logs and Correlation IDs

- Send `X-Correlation-ID` on API calls to connect request logs, service logs, and error responses.
- If the header is missing or invalid, the service generates a correlation ID and returns it in the response header.
- Structured logs include safe fields such as `correlationId`, `requestId`, `paymentIntentId`, `webhookEventId`, `externalEventId`, `provider`, `jobId`, `status`, `errorCode`, `method`, `path`, and `durationMs`.
- Never log webhook secrets, full signatures, raw request bodies, or sensitive payload fields.
- Use the correlation ID to follow a request from `http_request_completed` through payment, webhook, outbox, or worker log events.

## Operational Gaps

- Authenticated manual retry endpoint.
- Metrics dashboards.
- Alerting.
- Dead-letter inspection.
- Automated deployment runbook.
