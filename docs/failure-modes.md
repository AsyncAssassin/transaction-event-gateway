# Failure Modes

## Overview

Failure handling follows the architecture principle that PostgreSQL is authoritative and Redis is disposable infrastructure. Durable state, database constraints, transactions, and worker idempotency provide correctness under retries and partial failures.

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

Scenario: `POST /webhooks/blockchain` includes a missing or incorrect HMAC signature.

Expected behavior:

- Return `401 Unauthorized`.
- Do not persist the payload.
- Do not create an outbox event.
- Do not enqueue a BullMQ job.
- Log provider, event ID if safely parsed, signature version, and rejection reason. Do not log full signatures or secrets.

Protection:

- HMAC SHA-256 over `timestamp.nonce.raw_request_body`.
- Timing-safe comparison.

## Stale Timestamp

Scenario: Webhook timestamp is outside the configured tolerance window.

Expected behavior:

- Return `408 Request Timeout`.
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
- Log a structured security anomaly with provider, nonce hash, and event identifiers where safe.

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

## Redis Unavailable

Scenario: Redis is unavailable for BullMQ.

Expected behavior:

- Payment intent creation can still operate.
- Webhook acceptance can still persist inbox and outbox records.
- Outbox dispatch and worker processing pause until Redis recovers.
- Readiness should report queue infrastructure unavailable for queue-producing processes.

Protection:

- Correctness does not depend on Redis TTLs, in-memory locks, or queue uniqueness.
- Pending outbox rows preserve work.

## PostgreSQL Unavailable

Scenario: PostgreSQL is unavailable or cannot complete required transactions.

Expected behavior:

- API operations requiring durable state return `503 Service Unavailable`.
- The service must not fall back to Redis or memory for idempotency or business state.
- Webhook payloads are not accepted unless they can be durably persisted.
- Readiness should report unavailable.

Protection:

- PostgreSQL is the only source of truth.
- No alternative volatile persistence path exists.

## Worker Crash Mid-Processing

Scenario: Worker crashes while processing a BullMQ job.

Expected behavior:

- If crash happens before transaction commit, PostgreSQL rolls back changes and BullMQ retries.
- If crash happens after commit but before job acknowledgement, the next attempt exits successfully after seeing the event already processed.
- Processing attempts should show the failure or repeated execution where possible.

Protection:

- Worker transaction wraps payment state mutation and webhook processing state.
- Row lock on `webhook_events`.
- Idempotent processed-state check.

## Unknown Payment Intent

Scenario: A valid webhook references a payment intent that does not exist.

Expected behavior:

- Webhook acceptance may still persist the event and outbox row after signature validation.
- Worker marks the event `FAILED` with reason `UNKNOWN_PAYMENT_INTENT`.
- No payment intent is created from the webhook in the MVP.
- Future reconciliation may handle delayed or unknown events, but it is outside MVP.

Protection:

- Worker reloads durable state from PostgreSQL and validates references before mutation.
- The MVP does not infer or create payment intents from external events.

## Conflicting Provider Payload

Scenario: Provider sends the same event ID with a different payload hash, or the payload conflicts with the referenced payment intent.

Expected behavior for same event ID with different payload:

- Return `409 Conflict`.
- Use error code `WEBHOOK_EVENT_CONFLICT`.
- Do not process the new payload.
- Log provider, event ID, existing payload hash, and new payload hash.

Expected behavior for domain mismatch during worker processing:

- Mark webhook event `FAILED` with a sanitized reason.
- Do not update the payment intent.
- Record a processing attempt.

Protection:

- Unique `(provider, external_event_id)` plus `payload_hash`.
- Worker validation for amount, asset, reference, and state transition rules.
