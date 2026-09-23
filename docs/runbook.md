# Operational Runbook

## Purpose

This runbook covers local operation of `transaction-event-gateway`: health checks, state inspection, outbox and worker diagnosis, safe local resets, and log correlation. PostgreSQL is the source of truth; Redis/BullMQ is queue infrastructure. Deployed checks are part of the [AWS deployment runbook](aws-deployment-runbook.md).

## Service Topology

- **API process**: serves REST endpoints, validates payment intent requests, verifies signed webhooks, writes durable PostgreSQL state, and exposes Swagger plus health endpoints.
- **Worker process**: runs separately from the API and owns BullMQ consumption plus the outbox dispatcher runner.
- **PostgreSQL**: stores payment intents, idempotency records, webhook inbox rows, outbox rows, and processing attempts.
- **Redis/BullMQ**: stores queue state for asynchronous webhook processing. It is required for progress, not correctness.
- **Outbox dispatcher runner**: runs inside the worker process when `OUTBOX_DISPATCH_ENABLED=true`, polling eligible outbox rows every `OUTBOX_DISPATCH_INTERVAL_MS`.
- **Health endpoints**: `/health/live` checks process liveness; `/health/ready` checks configuration, PostgreSQL, and Redis (operators and deploy gates); `/health/serving` checks configuration and PostgreSQL only and is the load balancer target so Redis incidents do not drain API tasks.

## Quick Health Checks

```bash
curl -i http://localhost:3000/health/live
curl -i http://localhost:3000/health/ready
curl -i http://localhost:3000/health/serving
docker compose ps
npm run smoke:local
```

Healthy results:

- `/health/live` returns `200` with `status: "ok"`.
- `/health/ready` returns `200` with `checks.config`, `checks.postgres`, and `checks.redis` all `ok`.
- `/health/serving` returns `200` with `checks.config` and `checks.postgres` when the API can stay in load balancer rotation.
- `docker compose ps` shows PostgreSQL and Redis running and healthy.
- `npm run smoke:local` passes after PostgreSQL, Redis, the API process, and the worker process are running with matching local environment.

The smoke script reads PostgreSQL and Redis through the local Compose
containers, so it only checks the local stack.

## Rate Limiting

Current rate limiting is process-local, in-memory, and keyed by the request
source observed by Nest/Express. Local or direct traffic uses the request IP.
Behind ALB/proxy, the observed source may be the ALB/proxy or another shared
source, and limiter state is not shared across API tasks. Treat proxy-aware
forwarded-IP handling and distributed/shared rate limiting as a prerequisite or
known limitation before real multi-client traffic.

## Database Inspection

All commands below target the local Docker Compose PostgreSQL service. The state of a single payment intent is also available from the API: `curl http://localhost:3000/payment-intents/<id>`.

Recent payment intents:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, status, reference, amount, asset, client_request_id, confirmed_tx_hash, failure_reason, created_at, updated_at FROM payment_intents ORDER BY created_at DESC LIMIT 20;"
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
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, aggregate_id, status, attempts, next_attempt_at, last_error, created_at FROM outbox_events WHERE dead_at IS NULL AND ((status = 'PENDING' AND created_at < now() - interval '2 minutes') OR (status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))) ORDER BY created_at ASC LIMIT 50;"
```

Failed webhook events:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, external_event_id, payment_intent_id, tx_hash, failure_reason, processed_at FROM webhook_events WHERE status = 'FAILED' ORDER BY processed_at DESC LIMIT 50;"
```

Confirmed payment intents by transaction hash:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, status, reference, amount, asset, confirmed_tx_hash, updated_at FROM payment_intents WHERE confirmed_tx_hash = '<tx_hash>';"
```

## Outbox Troubleshooting

Outbox statuses:

- `PENDING`: accepted webhook work is durable but has not been published to BullMQ yet.
- `PUBLISHED`: dispatcher published the BullMQ job and marked the outbox row complete. If the webhook event is still unfinished 10 minutes later, the worker sets the row back to `FAILED` with `last_error = 'STALE_PUBLISHED_WEBHOOK_REQUEUED'` so that it is published again.
- `FAILED`: dispatcher attempted publication and stored retry metadata. A transient failure remains eligible for later dispatch when `dead_at` is null.

Retry metadata:

- `attempts`: number of failed publish attempts recorded for the outbox row.
- `next_attempt_at`: earliest time a failed row is eligible for another dispatch.
- `last_error`: sanitized dispatch failure reason.
- `dead_at`: set only for deterministic poison or non-retryable outbox payloads, such as a missing or non-string `webhookEventId`. It is not used for transient Redis, BullMQ, or publisher outages.

Find non-retryable poison outbox rows that need operator attention:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, aggregate_id, attempts, last_error, dead_at FROM outbox_events WHERE dead_at IS NOT NULL ORDER BY dead_at DESC LIMIT 50;"
```

Dead rows are poison/non-retryable records, not the normal backlog shape for a Redis outage. If manual data repair is intended, correct the payload first and intentionally reset the relevant retry fields, for example `dead_at`, `attempts`, and `next_attempt_at`; clearing only `dead_at` is not enough if the payload is still invalid.

Inspect transient retry backlog:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT id, aggregate_id, attempts, next_attempt_at, last_error, updated_at FROM outbox_events WHERE status = 'FAILED' AND dead_at IS NULL ORDER BY updated_at DESC LIMIT 50;"
```

If outbox rows are stuck:

- Confirm the worker process is running; the dispatcher runs in the worker, not the API.
- Confirm `OUTBOX_DISPATCH_ENABLED` is not disabled.
- Confirm Redis is reachable from the worker.
- Check `next_attempt_at` for failed rows that are waiting for backoff.
- Check `attempts`, `next_attempt_at`, and `last_error` to distinguish active capped-backoff retry from a quiet dispatcher.
- Check worker logs for `outbox_dispatch_failed`, `outbox_dispatch_poisoned`, `webhook_events_queue_poisoned`, `outbox_dispatch_runner_failed`, or `outbox_reconcile_failed`.
- Repeated Redis connection errors are summarized, not streamed: `worker_error` and `webhook_events_queue_poisoned` appear once per error code per 30 seconds with a `suppressedCount`, and `worker_redis_recovered` or `webhook_events_queue_recovered` marks the end of the outage.
- Remember webhook acceptance writes `webhook_events` and `outbox_events`; it does not publish directly to BullMQ.

## Worker Troubleshooting

The worker must run separately from the API:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway REDIS_URL=redis://localhost:6379 WEBHOOK_SECRET=local-development-placeholder-secret npm run start:worker
```

Worker jobs contain only `webhookEventId`, so the worker reloads durable state from PostgreSQL. Duplicate jobs should be safe because processing locks the webhook row and exits successfully if the event is already `PROCESSED`.

### Webhook event stays `QUEUED`

`PROCESSING` is only set inside the worker transaction, which always ends in `PROCESSED` or `FAILED` or rolls back, so a webhook event that does not finish stays `QUEUED`. If it stays `QUEUED`:

- Check that Redis is reachable and the worker process is consuming jobs.
- Inspect worker logs by `webhookEventId`. Each failed attempt logs `worker_job_failed`; after the fifth, BullMQ gives up and the worker logs `worker_job_exhausted`. A crashed attempt is retried once its job lock expires.
- A rolled-back attempt leaves no `webhook_processing_attempts` row, so missing attempt rows do not mean the job never ran.
- The worker reconciles such events on its own: once the outbox row has been `PUBLISHED` for 10 minutes, the next run (every 60 seconds) logs `outbox_reconcile_requeued` and the dispatcher publishes a new job. To recover sooner, or while the dispatcher is disabled, re-drive the event as described below.

### Re-drive a stuck webhook event

List webhook events whose outbox row was published more than 10 minutes ago but which never finished:

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "SELECT w.id, w.external_event_id, w.status, o.published_at FROM webhook_events w JOIN outbox_events o ON o.aggregate_type = 'webhook_event' AND o.aggregate_id = w.id WHERE w.status IN ('RECEIVED', 'QUEUED') AND o.status = 'PUBLISHED' AND o.published_at < now() - interval '10 minutes' ORDER BY o.published_at;"
```

Hand them back to the dispatcher, which republishes them within a second; this is the same change the automatic reconciliation makes, and the 10-minute condition can be dropped to act at once. Add `AND w.id = '<webhook_event_id>'` to re-drive a single event. A duplicate job is harmless: the worker locks the webhook row and skips events that are already `PROCESSED`.

```bash
docker compose exec -T postgres psql -U app -d transaction_event_gateway -c "UPDATE outbox_events o SET status = 'FAILED', next_attempt_at = now(), last_error = 'MANUAL_REDRIVE', updated_at = now() FROM webhook_events w WHERE o.aggregate_type = 'webhook_event' AND o.aggregate_id = w.id AND o.status = 'PUBLISHED' AND w.status IN ('RECEIVED', 'QUEUED') AND o.published_at < now() - interval '10 minutes';"
```

### Webhook event is `FAILED`

`FAILED` is a durable domain decision, not a transient error, and is not retried:

- Read `webhook_events.failure_reason`.
- Read the latest `webhook_processing_attempts.error_message`.
- Compare the webhook payload against the referenced `payment_intents` row for amount, asset, current status, and transaction hash. `reference` is not part of the signed webhook DTO; unknown `reference` fields are rejected before worker processing.

## Webhook Failure Reasons

- `UNKNOWN_PAYMENT_INTENT`: the webhook references a payment intent ID that does not exist.
- `UNSUPPORTED_EVENT_TYPE`: the worker received an event type it does not process.
- `MISSING_TX_HASH`: a confirmed transaction event did not include a usable transaction hash.
- `AMOUNT_MISMATCH`: webhook amount does not match the payment intent amount.
- `ASSET_MISMATCH`: webhook asset does not match the payment intent asset.
- `PAYMENT_INTENT_TERMINAL`: the payment intent is already terminal or confirmed with a different transaction hash.
- `CONFIRMED_TX_HASH_CONFLICT`: the transaction hash is already attached to another payment intent.

## Redis Unavailable

- `/health/ready` should return unavailable because Redis readiness fails.
- `/health/serving` can remain healthy when configuration and PostgreSQL are healthy; this is the load balancer target.
- Payment intent creation and webhook acceptance are PostgreSQL-backed for correctness.
- Transient outbox publish failures remain `FAILED` with `dead_at` unset, capped `next_attempt_at`, sanitized `last_error`, and increasing `attempts`; retries continue indefinitely while Redis or BullMQ is unavailable.
- After Redis returns, the worker dispatcher resumes publishing eligible outbox rows and BullMQ processing continues. If Redis lost its data, reconciliation re-queues the affected webhook events 10 minutes after their publication.

## PostgreSQL Unavailable

- Durable API operations should fail because idempotency, webhook inbox, outbox, and payment state require PostgreSQL.
- The service must not fall back to Redis or memory for correctness.
- `/health/ready` and `/health/serving` should return unavailable because PostgreSQL readiness fails.
- Health endpoints use an isolated bounded PostgreSQL health pool, not the main TypeORM pool used by durable API and worker operations.
- Migrations and schema checks require PostgreSQL.
- A PostgreSQL that keeps connections open but stops answering is not detected quickly; see [known limitations](failure-modes.md#known-limitations).

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

For a full local infrastructure reset, which also discards the local database and queue data:

```bash
docker compose down
docker compose up -d postgres redis
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
```

If local Redis queue state is suspected, prefer restarting the local Redis container after stopping API and worker processes. There is no application-level queue cleanup command in `package.json`.

## Logs and Correlation IDs

- Send `X-Correlation-ID` on API calls to connect request logs, service logs, and error responses.
- If the header is missing or invalid, the service generates a correlation ID and returns it in the response header.
- The API and worker in Docker Compose write one JSON object per line (`LOG_FORMAT=json`), so `docker compose logs --no-log-prefix api worker` can be piped to `jq`, for example `jq -c 'select(.event == "worker_job_processed")'`. Processes started with `npm run start:dev` or from `dist/` with the `.env` file use Nest's colored text format (`LOG_FORMAT=text`). Only allow-listed fields are written: `correlationId`, `requestId`, `paymentIntentId`, `webhookEventId`, `externalEventId`, `provider`, `jobId`, `status`, `errorCode`, `method`, `path`, `durationMs`, `suppressedCount`, `errorName`, `causeCode`, and `stackTop`.
- `http_request_failed` (5xx responses) and the worker and dispatcher failure events (`worker_job_failed`, `worker_job_exhausted`, `outbox_dispatch_failed`, `outbox_dispatch_runner_failed`, `outbox_reconcile_failed`) add `errorName`, `causeCode` (an error code, SQLSTATE, or errno such as `ECONNREFUSED` or `22021`), and `stackTop` (the first three stack frames). The error message itself is never logged, because PostgreSQL messages can contain submitted values.
- `http_request_data_exception` (warn) means PostgreSQL rejected a submitted value that request validation let through; the request got `400`, and `causeCode` holds the SQLSTATE.
- Webhook secrets, signatures, raw request bodies, and payload fields are never logged.
- The correlation ID covers one HTTP request: `http_request_completed`, `http_request_failed`, and the payment intent and webhook events logged while serving it. It is not carried into the outbox or BullMQ jobs; dispatcher and worker events carry `webhookEventId` and `jobId` instead. To connect them to a webhook request, look up the `webhook_events` row by `external_event_id` (the `externalEventId` in `webhook_accepted`).

## Operational Gaps

- Manual retry endpoint (re-drives use SQL).
- Metrics dashboards.
- Alerting.
- Dead-letter inspection.
- Deployment automation.
