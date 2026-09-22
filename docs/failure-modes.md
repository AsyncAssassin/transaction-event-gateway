# Failure Modes

## Overview

PostgreSQL is authoritative; Redis holds only BullMQ queue state, so losing it delays processing until reconciliation but never loses an accepted webhook. Durable state, database constraints, transactions, and worker idempotency provide correctness under retries and partial failures. Behavior that is not covered yet is listed under [Known Limitations](#known-limitations).

## Duplicate Payment Intent Request

Scenario: A client repeats `POST /payment-intents` with the same `Idempotency-Key` and the same logical payload.

Expected behavior:

- Return the stored response.
- Use `200 OK` with `Idempotent-Replayed: true`.
- Do not create another `payment_intents` row.
- Do not overwrite the original idempotency record.

Protection:

- Unique `(scope, idempotency_key)` on `idempotency_records`.
- Stored `request_hash` and response snapshot.

## Idempotency Conflict

Scenario: A client repeats `POST /payment-intents` with the same `Idempotency-Key` and a different logical payload.

Expected behavior:

- Return `409 Conflict`.
- Use error code `IDEMPOTENCY_CONFLICT`.
- Do not mutate the original payment intent.
- Log a structured warning without sensitive payload data.

Protection:

- Canonical request hash comparison under the unique idempotency key.

## Invalid Webhook Signature

Scenario: `POST /webhooks/blockchain` has a missing, malformed, or incorrect HMAC signature.

Expected behavior:

- A missing `X-Webhook-Signature` header or one that does not use the `v1=<hex>` format returns `400 Bad Request` with `VALIDATION_ERROR`.
- A well-formed signature that does not match returns `401 Unauthorized` with `INVALID_WEBHOOK_SIGNATURE`.
- Do not persist the payload, create an outbox event, or enqueue a BullMQ job.
- Log `webhook_rejected` with the provider, the event ID when the body parsed, and the error code. Signatures, secrets, and bodies are never logged.

Protection:

- HMAC SHA-256 over `timestamp.nonce.raw_request_body`.
- Timing-safe comparison.

## Stale Timestamp

Scenario: Webhook timestamp is outside the configured tolerance window.

Expected behavior:

- Return `400 Bad Request` with `STALE_WEBHOOK_TIMESTAMP` (not 408, which would invite futile automatic retries of a timestamp fixed inside the signed payload).
- Do not persist the payload.
- Do not create an outbox event.
- The same event may be sent again with a fresh timestamp and valid signature.

Protection:

- Default 5 minute timestamp tolerance.
- Durable nonce and event ID checks after signature and DTO validation.

## Duplicate Webhook

Scenario: Provider sends the same event ID and same payload more than once.

Expected behavior:

- Return an idempotent accepted response, usually `202 Accepted`.
- Response body should use `ALREADY_ACCEPTED`.
- Do not insert another `webhook_events` row.
- Do not create unnecessary duplicate durable work for the same accepted webhook.

Protection:

- Unique `(provider, external_event_id)`.
- `payload_hash` comparison.
- Worker idempotency if duplicate jobs are later published.

## Nonce Replay

Scenario: Provider nonce is reused for a different event.

Expected behavior:

- Return `409 Conflict`.
- Use error code `WEBHOOK_NONCE_REPLAY`.
- Do not process the new payload.
- Log `webhook_rejected` with the provider, event ID, and `WEBHOOK_NONCE_REPLAY`. The nonce itself is not logged.

Protection:

- Partial unique `(provider, nonce)` on `webhook_events`.
- HMAC binding includes the nonce in signed payload.

## Queue Publish Failure

Scenario: Webhook acceptance commits to PostgreSQL, but Redis publish fails during outbox dispatch.

Expected behavior:

- Accepted webhook remains durable in `webhook_events`.
- Outbox event remains `PENDING` or becomes `FAILED` with retry metadata.
- Dispatcher retries publication with backoff.
- Duplicate publication is allowed and must not corrupt state.

Protection:

- Transactional outbox.
- BullMQ jobs contain durable IDs only.
- Worker locks and checks `webhook_events.status`.

## Webhook Job Lost or Retries Exhausted

Scenario: The dispatcher published a job for an accepted webhook, but the job disappears from Redis (a flush, a failover without persistence, eviction under a policy other than `noeviction`), or it fails all five BullMQ attempts, for example because PostgreSQL is unavailable for more than about 75 seconds while it is processed.

Expected behavior:

- The worker transaction rolls back on every failed attempt, so the webhook event stays `QUEUED` and the payment intent unchanged. After the fifth failed attempt the worker logs `worker_job_exhausted`.
- Every 60 seconds the worker hands outbox rows that were `PUBLISHED` more than 10 minutes ago, and whose webhook event is still `RECEIVED` or `QUEUED`, back to the dispatcher: the row becomes `FAILED` with `next_attempt_at = now()` and `last_error = 'STALE_PUBLISHED_WEBHOOK_REQUEUED'`, and `outbox_reconcile_requeued` is logged with the `webhookEventId`.
- The dispatcher publishes a new job within a second, and the event is processed 10 to 11 minutes after its last publication.
- A repeated delivery from the provider is answered with `ALREADY_ACCEPTED` and does not speed this up; to recover immediately, re-drive the event with SQL (see [Re-drive a stuck webhook event](runbook.md#re-drive-a-stuck-webhook-event)).

Protection:

- Reconciliation runs as one `UPDATE ... FROM` over at most 100 rows with `FOR UPDATE SKIP LOCKED`, so several worker processes can run it at once and webhook events that a worker is processing right now are skipped.
- A duplicate job is harmless: the worker locks the webhook row and skips events that are already `PROCESSED`.

## Redis Unavailable

Scenario: Redis is unavailable for BullMQ.

Expected behavior:

- Payment intent creation can still operate.
- Webhook acceptance can still persist inbox and outbox records.
- The API process holds no BullMQ connection, so a Redis outage produces no queue reconnect noise in API logs; only the `/health/ready` probe reports it.
- Outbox dispatch records transient failures as retryable `FAILED` rows with capped `next_attempt_at`, sanitized `last_error`, and `dead_at` unset; retries continue until Redis recovers.
- The worker logs one `worker_error` and one `webhook_events_queue_poisoned` per error code per 30 seconds with a `suppressedCount`, then `worker_redis_recovered` and `webhook_events_queue_recovered` once Redis is back.
- `/health/ready` (config, PostgreSQL, Redis) reports unavailable, but `/health/serving` (config and PostgreSQL only) stays healthy. The load balancer uses `/health/serving`, so API tasks are not drained and keep serving payment intent creation and webhook acceptance during a Redis incident.

Protection:

- Correctness does not depend on Redis TTLs, in-memory locks, or queue uniqueness.
- Pending outbox rows preserve work, and reconciliation re-queues jobs that were lost with Redis data.

## Rate Limit Source Behind ALB/Proxy

Scenario: public API traffic reaches the service through ALB or another proxy.

Expected behavior:

- The current API limiter keys by the request source observed by Nest/Express.
- Local or direct traffic is limited by the request IP.
- Behind ALB/proxy, the observed source may be the ALB/proxy or another shared source, so unrelated clients can share the same limiter bucket.
- Limiter state is process-local and is not distributed across API tasks.

Protection:

- No trust proxy, `X-Forwarded-For` tracker, Redis-backed throttler, or distributed/shared limiter is implemented in the MVP.
- Before real multi-client traffic, implement proxy-aware and distributed rate limiting or accept this as a known limitation.

## PostgreSQL Unavailable

Scenario: PostgreSQL refuses or drops connections, or a new connection cannot be opened within 5 seconds.

Expected behavior:

- API operations requiring durable state return `503 Service Unavailable` with `SERVICE_UNAVAILABLE`.
- The service does not fall back to Redis or memory for idempotency or business state.
- Webhook payloads are not accepted unless they can be durably persisted.
- `/health/ready` and `/health/serving` return `503`.

A PostgreSQL that keeps connections open but stops answering behaves differently; see [Known Limitations](#known-limitations).

Protection:

- PostgreSQL is the only source of truth.
- No alternative volatile persistence path exists.

## Worker Crash Mid-Processing

Scenario: Worker crashes while processing a BullMQ job.

Expected behavior:

- If the crash happens before the transaction commits, PostgreSQL rolls back all changes, including the processing attempt row, and BullMQ retries the job once its lock expires.
- If the crash happens after commit but before the job is acknowledged, the next attempt sees the event already `PROCESSED`, records a `SUCCEEDED` attempt, and completes.

Protection:

- Worker transaction wraps payment state mutation and webhook processing state.
- Row lock on `webhook_events`.
- Idempotent processed-state check.

## Unknown Payment Intent

Scenario: A valid webhook references a payment intent that does not exist.

Expected behavior:

- Webhook acceptance may still persist the event and outbox row after signature validation.
- Worker marks the event `FAILED` with reason `UNKNOWN_PAYMENT_INTENT`.
- No payment intent is created from the webhook.
- The event is not retried later, so a webhook that arrives before its payment intent stays `FAILED`.

Protection:

- Worker reloads durable state from PostgreSQL and validates the referenced payment intent before mutation.
- The MVP does not infer or create payment intents from external events.

## Conflicting Provider Payload

Scenario: Provider sends the same event ID with a different payload hash, or the payload conflicts with the referenced payment intent.

Expected behavior for same event ID with different payload:

- Return `409 Conflict`.
- Use error code `WEBHOOK_EVENT_CONFLICT`.
- Do not process the new payload.
- Log `webhook_rejected` with the provider, event ID, and `WEBHOOK_EVENT_CONFLICT`. Payload hashes are stored in `webhook_events.payload_hash`, not logged.

Expected behavior for domain mismatch during worker processing:

- Mark webhook event `FAILED` with a sanitized reason.
- Do not update the payment intent.
- Record a processing attempt.

Protection:

- Unique `(provider, external_event_id)` plus `payload_hash`.
- Worker validation for amount, asset, transaction hash, and state transition rules. `reference` is not part of the signed webhook DTO, so an unknown `reference` field is rejected before worker processing.

## Known Limitations

### Slow Recovery of Lost Jobs

Reconciliation waits 10 minutes after publication, so a lost or exhausted job delays its payment confirmation by 10 to 11 minutes unless an operator re-drives it. A job that is only waiting in a backlog for longer than that gets one duplicate every 10 minutes; duplicates are harmless but add load. An event whose processing throws on every attempt, which is a bug rather than a domain failure, is retried every 10 minutes indefinitely and shows up as repeated `worker_job_exhausted` and `outbox_reconcile_requeued` lines for the same `webhookEventId`.

### PostgreSQL That Stops Answering

The main connection pool (10 connections, 5 second connect timeout) sets no query timeout and no TCP keepalive; a global `statement_timeout` is left out on purpose because it would abort worker transactions that wait on row locks. If established connections stop receiving answers, for example when the network path silently drops them, queries on them never complete. Once all pool connections are stuck, durable API requests wait 5 seconds for a free connection and return `503`, and the worker's dispatcher and job processing stall without logging. The health endpoints use a separate one-connection pool that opens fresh connections with 1 second connect and 2 second statement timeouts, so they can keep returning `200` meanwhile. Restarting the process recovers.

### Redis That Stops Answering

The connection that publishes jobs has no command timeout. A Redis that accepts connections but stops answering blocks the dispatcher's publish call while its transaction holds row locks on the selected outbox rows, and nothing is logged until the connection fails.

### No Worker Health Signal

The worker process has no health endpoint or heartbeat. ECS and Docker Compose restart it only when the process exits, so a stalled worker stays in service; watch for missing `outbox_dispatch_published` and `worker_job_processed` events while webhooks are being accepted.
