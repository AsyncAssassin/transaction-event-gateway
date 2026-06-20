# Database Specification

## Overview

PostgreSQL is the durable source of truth for business state, idempotency, webhook inbox records, outbox records, and processing audit records. Redis and BullMQ must not be required for correctness.

All write paths that couple business state with idempotency or processing state must use explicit PostgreSQL transactions.

## Enum Definitions

```sql
payment_intent_status:
  CREATED
  PROCESSING
  CONFIRMED
  FAILED
  EXPIRED

webhook_event_status:
  RECEIVED
  QUEUED
  PROCESSING
  PROCESSED
  FAILED
  REJECTED

outbox_event_status:
  PENDING
  PUBLISHED
  FAILED

webhook_processing_attempt_status:
  STARTED
  SUCCEEDED
  FAILED
```

The first three enum groups should be PostgreSQL enum types because they guard durable state transitions. `webhook_processing_attempt_status` may be either an enum type or a constrained varchar in the MVP.

## Tables

### payment_intents

```text
id uuid primary key
status payment_intent_status not null
amount numeric(36, 18) not null
asset varchar(32) not null
destination varchar(255) not null
reference varchar(255) null
client_request_id varchar(255) null
metadata jsonb not null default '{}'
confirmed_tx_hash varchar(255) null
failure_reason text null
expires_at timestamptz null
created_at timestamptz not null
updated_at timestamptz not null
```

Indexes and constraints:

```text
primary key (id)
index payment_intents_status_idx (status)
index payment_intents_created_at_idx (created_at)
index payment_intents_client_request_id_idx (client_request_id)
index payment_intents_reference_idx (reference)
unique payment_intents_confirmed_tx_hash_uniq (confirmed_tx_hash) where confirmed_tx_hash is not null
check payment_intents_amount_positive_chk (amount > 0)
```

Correctness rationale:

- Primary key gives stable durable identity for API responses and worker references.
- Positive amount check prevents invalid persisted payment state.
- Unique confirmed transaction hash prevents one external transaction from confirming multiple intents.
- Status and time indexes support expiration scans and operational queries.
- Client request and reference indexes support correlation without making those values authoritative identifiers.

### idempotency_records

```text
id uuid primary key
scope varchar(128) not null
idempotency_key varchar(255) not null
request_hash varchar(128) not null
response_status integer null
response_body jsonb null
resource_type varchar(128) null
resource_id uuid null
created_at timestamptz not null
expires_at timestamptz null
```

Indexes and constraints:

```text
unique idempotency_records_scope_key_uniq (scope, idempotency_key)
index idempotency_records_expires_at_idx (expires_at)
index idempotency_records_resource_idx (resource_type, resource_id)
```

Correctness rationale:

- Unique `(scope, idempotency_key)` serializes concurrent duplicate create requests.
- `request_hash` differentiates safe replay from same-key different-payload conflict.
- Response snapshot fields make successful replay deterministic.
- Resource fields connect the idempotency decision to the created business entity.
- Expiration supports cleanup only; correctness for active records comes from the unique constraint.

### webhook_events

```text
id uuid primary key
provider varchar(128) not null
external_event_id varchar(255) not null
nonce varchar(255) null
event_type varchar(128) not null
payment_intent_id uuid null
tx_hash varchar(255) null
payload jsonb not null
payload_hash varchar(128) not null
status webhook_event_status not null
failure_reason text null
received_at timestamptz not null
processed_at timestamptz null
created_at timestamptz not null
updated_at timestamptz not null
```

Indexes and constraints:

```text
primary key (id)
unique webhook_events_provider_external_event_id_uniq (provider, external_event_id)
unique webhook_events_provider_nonce_uniq (provider, nonce) where nonce is not null
index webhook_events_payment_intent_id_idx (payment_intent_id)
index webhook_events_status_received_at_idx (status, received_at)
index webhook_events_tx_hash_idx (tx_hash)
index webhook_events_payload_hash_idx (payload_hash)
```

Correctness rationale:

- Unique provider event ID makes webhook acceptance idempotent.
- Unique provider nonce prevents durable nonce replay when the provider supplies a nonce.
- Payload hash supports conflict detection for reused event IDs.
- No foreign key is used for `payment_intent_id` in the MVP so a valid signed event that references an unknown payment intent can still be durably recorded and later marked `FAILED` by the worker.
- Status and received time index supports dispatch, retry, and monitoring queries.
- Transaction hash index supports reconciliation and duplicate transaction investigation.

### outbox_events

```text
id uuid primary key
type varchar(128) not null
aggregate_type varchar(128) not null
aggregate_id uuid not null
payload jsonb not null
status outbox_event_status not null
attempts integer not null default 0
next_attempt_at timestamptz null
last_error text null
created_at timestamptz not null
published_at timestamptz null
updated_at timestamptz not null
```

Indexes and constraints:

```text
primary key (id)
index outbox_events_status_next_attempt_idx (status, next_attempt_at)
index outbox_events_aggregate_idx (aggregate_type, aggregate_id)
check outbox_events_attempts_non_negative_chk (attempts >= 0)
```

Correctness rationale:

- Outbox records prevent accepted webhook events from being lost when Redis publication fails.
- Pending status index keeps dispatcher polling efficient.
- Aggregate index links each outbox event to the durable webhook event.
- Attempt metadata supports bounded retry with backoff and sanitized error reporting.
- Duplicate publication is acceptable because worker processing is idempotent.

### webhook_processing_attempts

```text
id uuid primary key
webhook_event_id uuid not null
job_id varchar(255) null
status varchar(64) not null
error_message text null
started_at timestamptz not null
finished_at timestamptz null
created_at timestamptz not null
```

Indexes and constraints:

```text
primary key (id)
index webhook_processing_attempts_event_idx (webhook_event_id)
index webhook_processing_attempts_status_idx (status)
foreign key webhook_processing_attempts_event_fk (webhook_event_id) references webhook_events(id)
check webhook_processing_attempts_finished_after_started_chk (finished_at is null or finished_at >= started_at)
```

Correctness rationale:

- Attempt rows provide auditability and operational debugging.
- Correctness does not depend on this table; webhook status and payment intent status are authoritative.
- Foreign key prevents orphan processing attempts.
- Timestamp check prevents impossible attempt timelines.

## Migration Order

1. Enable required PostgreSQL extensions for UUID generation if the application does not generate UUIDs itself.
2. Create enum types.
3. Create `payment_intents`.
4. Create `idempotency_records`.
5. Create `webhook_events`.
6. Create `outbox_events`.
7. Create `webhook_processing_attempts`.
8. Add secondary indexes and partial unique indexes.
9. Add foreign keys after referenced tables exist. In the MVP this applies to `webhook_processing_attempts.webhook_event_id`, not to `webhook_events.payment_intent_id`.

Keep migrations small enough to review and roll back. Do not combine unrelated schema changes with data backfills.

## Transaction Boundaries

### Payment Intent Creation

One transaction must include:

- Insert `idempotency_records`.
- Insert `payment_intents`.
- Store response snapshot, `resource_type`, and `resource_id` on the idempotency record.

The idempotency record and payment intent must commit atomically.

### Webhook Acceptance

Before transaction:

- Validate timestamp.
- Verify HMAC over the raw request body.
- Validate DTO shape.

One transaction must include:

- Insert `webhook_events`.
- Insert `outbox_events`.

The API must not publish directly to BullMQ inside this acceptance flow.

### Outbox Dispatch

Dispatcher operation should:

- Select eligible `PENDING` or retryable `FAILED` outbox rows using row locks.
- Publish a BullMQ job containing durable IDs only.
- Mark the outbox row `PUBLISHED` after publication succeeds.
- Record attempts, next retry time, and sanitized errors when publication fails.

Publishing to Redis and updating PostgreSQL is not atomic across systems, so duplicate publication must remain safe.

### Worker Processing

One transaction must include:

- Lock the `webhook_events` row.
- Exit successfully if already `PROCESSED`.
- Mark the event `PROCESSING`.
- Lock the target `payment_intents` row.
- Validate amount, asset, reference, and state transition rules.
- Apply payment intent state transition.
- Mark webhook event `PROCESSED` or durable `FAILED`.
- Insert a `webhook_processing_attempts` row.

If the worker crashes before commit, PostgreSQL rolls back the state changes and BullMQ retries.

## Rollback Notes

- Enum rollback should drop dependent tables or constraints before dropping enum types.
- Partial unique indexes can be dropped independently when rolling back an index-only migration.
- Do not roll back by deleting durable business rows in shared environments.
- Failed forward migrations should leave the database either unchanged or with clearly reversible objects.
- Data migrations must include explicit rollback notes, even if rollback is "not safe automatically; restore from backup or apply compensating migration."
- Outbox and webhook inbox data should be treated as audit data. Avoid destructive rollback steps after production traffic has written rows.

## Constraint Correctness Summary

| Risk | Database protection |
| --- | --- |
| Concurrent duplicate payment intent request | Unique `(scope, idempotency_key)` |
| Same key with different payload | Stored `request_hash` checked under the unique key |
| Invalid amount | `amount > 0` check |
| One transaction confirming multiple intents | Partial unique `confirmed_tx_hash` |
| Duplicate webhook delivery | Unique `(provider, external_event_id)` |
| Nonce replay | Partial unique `(provider, nonce)` |
| Duplicate queue jobs | Worker row lock and webhook status check |
| Concurrent updates to one payment intent | Row lock on `payment_intents` and domain transition rules |
| Accepted webhook lost before queue publish | Webhook inbox plus transactional outbox |
