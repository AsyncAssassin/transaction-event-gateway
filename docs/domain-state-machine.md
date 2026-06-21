# Domain State Machine Specification

Status: Current MVP lifecycle specification
Scope: current MVP payment intent, webhook inbox, outbox, and worker lifecycle
Source of truth: PostgreSQL durable state and current implementation

## 1. Purpose and Scope

This document describes the domain lifecycle for payment intent creation,
signed webhook acceptance, transactional outbox dispatch, and worker
processing.

The state machine is intentionally centered on durable records:

- `payment_intents`
- `idempotency_records`
- `webhook_events`
- `outbox_events`
- `webhook_processing_attempts`

PostgreSQL is the source of truth for all lifecycle decisions. Redis and BullMQ
are transport infrastructure only. BullMQ jobs carry durable PostgreSQL IDs and
do not carry authoritative payment or webhook business data.

This specification covers the implemented MVP behavior. It does not introduce
new endpoints, retries, reconciliation, provider integrations, or state changes
that are not present in the current code.

## 2. Domain Entities

### `PaymentIntent`

Durable business object created by `POST /payment-intents`.

Core lifecycle fields:

- `id`
- `status`
- `amount`
- `asset`
- `destination`
- `reference`
- `clientRequestId`
- `metadata`
- `confirmedTxHash`
- `failureReason`
- `expiresAt`
- `createdAt`
- `updatedAt`

The worker locks the payment intent before applying webhook processing rules.
For a matching confirmed transaction event, the worker sets
`status = CONFIRMED` and records `confirmedTxHash`.

### `WebhookEvent`

Durable inbox row created by `POST /webhooks/blockchain` after timestamp,
signature, and DTO validation succeed.

Core lifecycle fields:

- `id`
- `provider`
- `externalEventId`
- `nonce`
- `eventType`
- `paymentIntentId`
- `txHash`
- `payload`
- `payloadHash`
- `status`
- `failureReason`
- `receivedAt`
- `processedAt`
- `createdAt`
- `updatedAt`

The worker locks this row first. If it is already `PROCESSED`, worker
processing exits successfully without mutating the payment intent.

### `OutboxEvent`

Durable work record inserted in the same PostgreSQL transaction as a newly
accepted webhook event.

Core lifecycle fields:

- `id`
- `type`
- `aggregateType`
- `aggregateId`
- `payload`
- `status`
- `attempts`
- `nextAttemptAt`
- `lastError`
- `createdAt`
- `publishedAt`
- `updatedAt`

For webhook processing, `type = process-webhook-event`,
`aggregateType = webhook_event`, and the payload contains only
`webhookEventId`.

### `WebhookProcessingAttempt`

Audit row inserted by worker processing.

Core lifecycle fields:

- `id`
- `webhookEventId`
- `jobId`
- `status`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `createdAt`

Attempt rows explain worker decisions. Correctness comes from
`payment_intents` and `webhook_events`, not from attempt rows.

### `IdempotencyRecord`

Durable idempotency record used by `POST /payment-intents`.

Core lifecycle fields:

- `id`
- `scope`
- `idempotencyKey`
- `requestHash`
- `responseStatus`
- `responseBody`
- `resourceType`
- `resourceId`
- `createdAt`
- `expiresAt`

The idempotency record and payment intent are created in one PostgreSQL
transaction.

## 3. Payment Intent Statuses

```text
CREATED
PROCESSING
CONFIRMED
FAILED
EXPIRED
```

Meaning:

- `CREATED`: the API created the payment intent and it is waiting for a
  matching external confirmation event.
- `PROCESSING`: durable enum value reserved by the broader lifecycle model. The
  current webhook worker does not write this status before confirming a
  matching event.
- `CONFIRMED`: a matching confirmed transaction event was applied and
  `confirmedTxHash` is set.
- `FAILED`: terminal payment intent status. The current webhook worker does not
  move an intent into this status for webhook validation failures.
- `EXPIRED`: terminal payment intent status. Expiration processing is outside
  the current worker implementation.

Terminal payment intent statuses:

```text
CONFIRMED
FAILED
EXPIRED
```

Implemented worker transition behavior:

| Current payment intent status | Matching confirmed webhook result | Payment intent effect | Webhook effect |
| --- | --- | --- | --- |
| `CREATED` | amount, asset, optional reference, and transaction hash are valid | `CONFIRMED`, `confirmedTxHash` set | `PROCESSED` |
| `PROCESSING` | amount, asset, optional reference, and transaction hash are valid | `CONFIRMED`, `confirmedTxHash` set | `PROCESSED` |
| `CONFIRMED` | same `confirmedTxHash` | No payment intent change | `PROCESSED` |
| `CONFIRMED` | different transaction hash after other validation passes | No payment intent change | `FAILED` with `PAYMENT_INTENT_TERMINAL` |
| `FAILED` | any otherwise valid confirmed webhook | No payment intent change | `FAILED` with `PAYMENT_INTENT_TERMINAL` |
| `EXPIRED` | any otherwise valid confirmed webhook | No payment intent change | `FAILED` with `PAYMENT_INTENT_TERMINAL` |

Payload mismatches, unsupported event types, missing transaction hashes, unknown
payment intents, and transaction hash conflicts do not mutate the payment
intent.

## 4. Webhook Event Statuses

```text
RECEIVED
QUEUED
PROCESSING
PROCESSED
FAILED
REJECTED
```

Meaning:

- `RECEIVED`: signed webhook was accepted and persisted in the inbox.
- `QUEUED`: outbox dispatcher published the BullMQ job and marked the durable
  webhook event queued.
- `PROCESSING`: worker locked the durable webhook event and started applying
  processing rules.
- `PROCESSED`: worker completed successfully. This includes an idempotent
  success when the referenced payment intent is already confirmed with the same
  transaction hash.
- `FAILED`: worker completed with a durable domain failure reason.
- `REJECTED`: durable enum value reserved for rejected webhook records. Current
  HTTP signature, timestamp, and DTO rejections are not persisted as rows;
  current worker domain failures are stored as `FAILED`.

Webhook transition table:

| From | To | Trigger |
| --- | --- | --- |
| none | `RECEIVED` | Valid signed webhook accepted into the inbox |
| `RECEIVED` | `QUEUED` | Outbox dispatcher publishes the BullMQ job |
| Current non-`PROCESSED` status reached by implemented flows | `PROCESSING` | Worker starts processing the durable event |
| `PROCESSING` | `PROCESSED` | Worker applies a successful processing result |
| `PROCESSING` | `FAILED` | Worker records a domain failure reason |
| `PROCESSED` | `PROCESSED` | Duplicate job or direct retry exits as already processed |

Current terminal webhook behavior:

- `PROCESSED` is short-circuited by the worker and is not processed again.
- `REJECTED` is a durable enum value for future persisted rejections; current
  flows do not create `REJECTED` rows.

`FAILED` is retryable by model, but the current public API does not implement a
manual retry endpoint.

## 5. Outbox Event Statuses

```text
PENDING
PUBLISHED
FAILED
```

Meaning:

- `PENDING`: webhook work is durable but has not been published to BullMQ.
- `PUBLISHED`: dispatcher published the BullMQ job and marked the outbox row
  complete.
- `FAILED`: dispatcher could not complete publication and recorded retry
  metadata.

Outbox transition table:

| From | To | Trigger |
| --- | --- | --- |
| none | `PENDING` | New accepted webhook creates an outbox row in the same transaction |
| `PENDING` | `PUBLISHED` | Dispatcher publishes job and marks webhook event `QUEUED` |
| `PENDING` | `FAILED` | Dispatcher catches a publish or dispatch error |
| `FAILED` | `PUBLISHED` | Dispatcher retry succeeds after `nextAttemptAt` |
| `FAILED` | `FAILED` | Dispatcher retry fails again and increments `attempts` |

Publishing to Redis and updating PostgreSQL are not atomic across systems.
Duplicate job publication is acceptable because worker processing is idempotent
and reloads state from PostgreSQL.

## 6. Worker Processing Outcomes

The processor returns one of three outcomes.

| Outcome | Durable behavior |
| --- | --- |
| `already_processed` | The webhook event was already `PROCESSED`. Insert a `SUCCEEDED` processing attempt and do not mutate the payment intent. |
| `processed` | Mark the webhook event `PROCESSED`, insert a `SUCCEEDED` processing attempt, and confirm the payment intent when a new valid confirmation was applied. |
| `failed` with reason | Mark the webhook event `FAILED`, store `failureReason`, insert a `FAILED` processing attempt with the same reason, and leave the payment intent unchanged. |

Domain failures are durable worker results. The BullMQ worker logs the failed
domain result and returns normally; correctness is stored in PostgreSQL.

## 7. Failure Reasons

| Reason | When recorded | State effect |
| --- | --- | --- |
| `UNKNOWN_PAYMENT_INTENT` | The webhook references no existing payment intent row. | Webhook `FAILED`; no payment intent created. |
| `UNSUPPORTED_EVENT_TYPE` | `payload.type` is not `transaction.confirmed`. | Webhook `FAILED`; no payment intent mutation. |
| `MISSING_TX_HASH` | Confirmed transaction event has no non-empty string transaction hash. | Webhook `FAILED`; no payment intent mutation. |
| `AMOUNT_MISMATCH` | Payload amount does not normalize to the payment intent amount. | Webhook `FAILED`; no payment intent mutation. |
| `ASSET_MISMATCH` | Payload asset differs from the payment intent asset. | Webhook `FAILED`; no payment intent mutation. |
| `REFERENCE_MISMATCH` | Persisted payload contains a string reference and it differs from the payment intent reference. | Webhook `FAILED`; no payment intent mutation. |
| `PAYMENT_INTENT_TERMINAL` | Payment intent is `FAILED` or `EXPIRED`, or it is `CONFIRMED` with a different transaction hash after validation passes. | Webhook `FAILED`; terminal payment intent remains unchanged. |
| `CONFIRMED_TX_HASH_CONFLICT` | Transaction hash is already attached to another payment intent. | Webhook `FAILED`; current payment intent remains unchanged. |

## 8. Idempotency Behavior

### Payment Intent Replay

Scope:

```text
payment-intents:create
```

Rules:

- The API canonicalizes the logical create payload and stores a SHA-256 request
  hash.
- Same `Idempotency-Key` and same logical payload returns the stored response
  with `200 OK` and `Idempotent-Replayed: true`.
- Replay does not create a second payment intent.
- Replay does not create an outbox event or webhook event.

### Idempotency Conflict

Rules:

- Same `Idempotency-Key` and different logical payload returns `409 Conflict`
  with `IDEMPOTENCY_CONFLICT`.
- The original payment intent and idempotency record are not mutated.
- Correctness is enforced by the PostgreSQL unique constraint on
  `(scope, idempotency_key)` plus request hash comparison.

### Webhook Duplicate Event

Rules:

- Same provider event ID and same payload hash returns `202 Accepted` with
  `ALREADY_ACCEPTED`.
- The existing webhook inbox row is reused.
- No additional outbox row is inserted for the duplicate acceptance path.

### Nonce Replay

Rules:

- Same provider nonce reused for a different event returns `409 Conflict` with
  `WEBHOOK_NONCE_REPLAY`.
- The new payload is not persisted.
- No outbox row or BullMQ job is created for the replayed nonce.

## 9. Valid High-Level Flows

### Create Payment Intent

```text
Client
  -> POST /payment-intents with Idempotency-Key
  -> PostgreSQL transaction
  -> insert idempotency_records
  -> insert payment_intents with status CREATED
  -> store response snapshot on idempotency_records
  -> commit
  -> return 201 Created
```

Durable result:

- `payment_intents.status = CREATED`
- `idempotency_records.responseStatus = 201`
- `idempotency_records.resourceType = payment_intent`
- `idempotency_records.resourceId = payment_intents.id`

### Accept Signed Webhook

```text
Provider
  -> POST /webhooks/blockchain
  -> validate timestamp
  -> verify HMAC over timestamp, nonce, and raw body
  -> validate DTO
  -> PostgreSQL transaction
  -> insert webhook_events with status RECEIVED
  -> insert outbox_events with status PENDING
  -> commit
  -> return 202 Accepted
```

Durable result:

- `webhook_events.status = RECEIVED`
- `outbox_events.status = PENDING`
- The outbox payload contains only `webhookEventId`

### Dispatch Outbox

```text
Dispatcher
  -> select eligible PENDING or retryable FAILED outbox rows with row locks
  -> publish BullMQ job with webhookEventId
  -> mark webhook_events RECEIVED -> QUEUED
  -> mark outbox_events PUBLISHED
```

Durable result on success:

- `webhook_events.status = QUEUED`
- `outbox_events.status = PUBLISHED`
- `outbox_events.publishedAt` is set

Durable result on dispatch failure:

- `outbox_events.status = FAILED`
- `outbox_events.attempts` increments
- `outbox_events.nextAttemptAt` is set
- `outbox_events.lastError` stores a sanitized error
- The webhook event remains durable for a later dispatch attempt

### Process Webhook Event

```text
Worker
  -> receive BullMQ job containing webhookEventId
  -> PostgreSQL transaction
  -> lock webhook_events row
  -> exit successfully if already PROCESSED
  -> mark webhook_events PROCESSING
  -> validate event type, tx hash, payment intent, amount, asset, reference, and terminal state
  -> lock payment_intents row when present
  -> confirm matching payment intent or record durable webhook failure
  -> insert webhook_processing_attempts
  -> commit
```

Durable result on success:

- `payment_intents.status = CONFIRMED` when a new confirmation is applied
- `payment_intents.confirmedTxHash` is set when a new confirmation is applied
- `webhook_events.status = PROCESSED`
- `webhook_events.processedAt` is set
- `webhook_processing_attempts.status = SUCCEEDED`

Durable result on domain failure:

- `payment_intents` remains unchanged
- `webhook_events.status = FAILED`
- `webhook_events.failureReason` is set
- `webhook_events.processedAt` is set
- `webhook_processing_attempts.status = FAILED`

## 10. What Does Not Emit a State Change

The following cases do not create a new durable lifecycle transition:

- Invalid webhook signature: no webhook event, no outbox event, no job.
- Stale webhook timestamp: no webhook event, no outbox event, no job.
- Invalid webhook DTO: no webhook event, no outbox event, no job.
- Duplicate payment intent replay with the same payload: returns stored response
  and creates no new payment intent.
- Payment intent idempotency conflict: returns `409 Conflict` and does not
  mutate the original payment intent.
- Duplicate identical webhook event: returns `ALREADY_ACCEPTED` and creates no
  new inbox or outbox row.
- Webhook event ID conflict: returns `409 Conflict` and does not persist the
  conflicting payload.
- Nonce replay: returns `409 Conflict` and does not persist the new payload.
- Already `PROCESSED` webhook event: worker records a `SUCCEEDED` attempt but
  does not mutate the payment intent.
- Confirmed payment intent with the same transaction hash: worker marks the
  webhook event `PROCESSED` and does not mutate the payment intent.
- Worker domain validation failure: worker marks the webhook event `FAILED` and
  leaves the payment intent unchanged.
- Outbox publish failure: no payment intent transition occurs; the outbox row
  is retryable from PostgreSQL state.

The current implementation does not create downstream domain outbox events when
a payment intent becomes `CONFIRMED`; the existing outbox is the durable bridge
from accepted webhook inbox rows to BullMQ processing jobs.

## 11. Source of Truth Boundary

PostgreSQL owns:

- Payment intent status and confirmed transaction hash.
- Idempotency key, request hash, and response replay snapshot.
- Webhook event status, payload hash, failure reason, and processed timestamp.
- Outbox status, attempt count, retry timestamp, and sanitized dispatch error.
- Worker processing attempt audit rows.

Redis and BullMQ own:

- Job transport.
- Retry scheduling for queue execution.
- Worker delivery.

Redis and BullMQ do not own:

- Payment intent correctness.
- Webhook idempotency.
- Nonce replay protection.
- Outbox completion truth.
- Worker decision truth.

## 12. Future Extensions Deferred

The following lifecycle extensions are intentionally outside this phase:

- Manual retry endpoint for failed webhook events.
- Durable `REJECTED` rows for post-acceptance rejected events.
- Worker-written `PROCESSING` payment intent transitions before confirmation.
- Expiration process that moves stale intents to `EXPIRED`.
- Explicit payment intent `FAILED` transitions from webhook domain failures.
- Additional provider event types beyond `transaction.confirmed`.
- Reversal, chargeback, or reorg states after `CONFIRMED`.
- Downstream domain event publication for payment intent status changes.
- Reconciliation for unknown or delayed external events.
