# Testing Strategy

## Overview

Tests should prove correctness under retries, duplicate requests, concurrent delivery, and worker failure. The architecture requires PostgreSQL for durable correctness and Redis/BullMQ for queue behavior, so integration and worker tests should exercise real infrastructure where behavior depends on database constraints or queue semantics.

## Unit Tests

Unit tests should avoid HTTP, PostgreSQL, Redis, and BullMQ.

Scope:

- Payment intent state transition rules.
- Invalid transition rejection.
- Terminal state behavior for `CONFIRMED`, `FAILED`, and `EXPIRED`.
- Request canonicalization and SHA-256 hashing.
- Idempotency decision logic for replay vs conflict.
- HMAC signature generation and validation helpers.
- Timestamp tolerance validation.
- Timing-safe comparison wrapper behavior.
- Webhook DTO classification and domain validation helpers.
- Sanitized error mapping for expected domain failures.

## Integration Tests

Integration tests should use real PostgreSQL and run migrations against a clean database.

Scope:

- Payment intent creation persists `payment_intents` and `idempotency_records` atomically.
- Same idempotency key with same payload returns the stored response.
- Same idempotency key with different payload returns conflict and leaves original state unchanged.
- Concurrent duplicate payment intent requests create one payment intent.
- Webhook acceptance with a valid signature persists `webhook_events` and `outbox_events` atomically.
- Duplicate webhook acceptance with the same payload is idempotent.
- Duplicate webhook event ID with a different payload is rejected.
- Nonce replay is rejected.
- Transaction rollback prevents partial records when persistence fails.
- Database constraints reject invalid amounts and duplicate confirmed transaction hashes.

## E2E Tests

E2E tests should boot the NestJS HTTP server and use Supertest.

Scope:

- `POST /payment-intents` happy path.
- `POST /payment-intents` validation errors.
- `POST /payment-intents` idempotent replay response and `Idempotent-Replayed` header.
- `POST /payment-intents` idempotency conflict.
- `POST /webhooks/blockchain` accepted path.
- Invalid webhook signature response.
- Stale webhook timestamp response.
- Duplicate webhook response.
- Full webhook-to-worker processing path with BullMQ enabled.
- Health endpoints once implemented.

## Worker Tests

Worker tests should use real PostgreSQL. Use real Redis/BullMQ when validating queue behavior and direct processor invocation when testing pure processing decisions.

Scope:

- Processing a matching webhook event moves payment intent state as expected.
- Processing the same job twice is safe.
- Already processed webhook event exits successfully.
- Worker crash or thrown error before commit leaves state unchanged.
- Unknown payment intent marks the webhook event `FAILED` with a sanitized reason.
- Amount, asset, or reference mismatch marks the event `FAILED` without corrupting payment intent state.
- Failed processing creates a `webhook_processing_attempts` row.
- Successful processing marks the webhook event `PROCESSED`.

## Concurrency and Idempotency Tests

Concurrency tests should target the database protections that make the design production-safe.

Scope:

- Parallel requests with the same idempotency key and same payload.
- Parallel requests with the same idempotency key and different payloads.
- Parallel webhook deliveries with the same provider event ID.
- Parallel webhook deliveries with the same nonce.
- Parallel worker execution for the same webhook event.
- Multiple webhook events attempting to update the same payment intent.
- Queue duplicate job delivery after outbox retry.

Expected outcomes:

- Exactly one durable payment intent for duplicate create requests.
- Exactly one durable webhook event for duplicate webhook delivery.
- No terminal payment intent state is overwritten by a later conflicting event.
- Duplicate worker execution has no repeated side effects.

## Testcontainers vs Docker Compose

Use Testcontainers for:

- CI-friendly isolated PostgreSQL and Redis.
- Integration tests requiring clean database state.
- Worker tests that need real BullMQ behavior.
- Concurrency tests that depend on actual database locking and constraints.

Use Docker Compose for:

- Local development.
- Manual end-to-end verification.
- Running the full API, worker, PostgreSQL, and Redis stack.
- Demonstrating operational behavior across separate API and worker processes.

If Testcontainers are introduced later, prefer them for CI isolation; the current e2e setup uses configured local PostgreSQL and Redis instances.

## Suggested Test Commands

Current commands implemented in `package.json`:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run smoke:local
```

Local infrastructure and schema verification:

```bash
docker compose up -d postgres redis
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:show
npm run test:e2e
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run typeorm -- schema:log
```

The e2e global setup runs migrations against the configured local PostgreSQL database before the e2e suite starts.

## Local Smoke Check

Use `npm run smoke:local` for a one-command local smoke check once PostgreSQL, Redis, the API process, and the worker process are already running. The script expects migrations to be applied and uses `SMOKE_BASE_URL` when the API is not on `http://localhost:3000`.

The command verifies health, OpenAPI, payment intent idempotency, signed webhook handling, webhook rejection paths, outbox publication, worker completion, and final PostgreSQL state. It creates rows with `smoke_` identifiers and leaves them in place for inspection.

Future deployed AWS smoke testing is documented separately in
[AWS deployed smoke test flow](aws-smoke-test-flow.md). Keep that flow
approval-gated and distinct from the local smoke script; no deployed smoke test
has been run in this documentation phase.

## Coverage Priorities

Prioritize tests for:

- Idempotency correctness.
- Webhook signature and replay protection.
- Transaction boundaries.
- Worker idempotency.
- Queue publish failure recovery through outbox.
- Domain state transitions.

Lower priority for MVP:

- Cosmetic response formatting.
- Metrics dashboards.
- Optional manual retry endpoint behavior before the endpoint is implemented.
