# Testing

## Suites

| Command | Files | Needs |
| --- | --- | --- |
| `npm test` | `src/**/*.spec.ts` (`jest.config.js`) | Nothing external: `pg`, `ioredis` and BullMQ queues are replaced by mocks. |
| `npm run test:e2e` | `test/*.e2e-spec.ts` (`test/jest-e2e.config.js`) | Real PostgreSQL and Redis. Suites run serially (`maxWorkers: 1`), and the global setup (`test/e2e-global-setup.ts`) runs the migrations first. |

The e2e suites boot Nest modules inside the test process: `AppModule` behind Supertest for HTTP behavior, `WorkerModule` for the dispatcher runner and the BullMQ consumer, and smaller module sets for the dispatcher and the processor. They start no separate API or worker process.

Both configurations load `test/jest.setup.ts`, which applies the defaults from `test/test-env.ts` to variables that are not already set (the e2e global setup applies them too):

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | `postgres://app:app@localhost:5432/transaction_event_gateway` |
| `REDIS_URL` | `redis://localhost:6379` |
| `WEBHOOK_SECRET` | `test-webhook-secret-value` |
| `OUTBOX_DISPATCH_ENABLED` | `false` |
| `RATE_LIMIT_ENABLED` | `false` |

The same file sets `NODE_ENV=test`, `PORT=3000`, `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300` and `OUTBOX_DISPATCH_INTERVAL_MS=1000`. Configuration is validated when a module is imported, so a suite that needs other values (the dispatcher runner and rate limiting suites) resets the module registry, sets the variables, imports the module dynamically and restores the variables afterwards.

## Running the e2e suite locally

```bash
docker compose stop api worker
docker compose up -d postgres redis
npm run test:e2e
```

- Stop the Compose `api` and `worker` services first. A running Compose worker consumes the same `webhook-events` queue, and its dispatcher publishes the outbox rows that the tests insert. The e2e global setup refuses to start while another BullMQ worker is connected to the `webhook-events` queue.
- The suites empty the application tables of the local database (`TRUNCATE ... RESTART IDENTITY CASCADE`) and remove every job from the local `webhook-events` queue. Do not run them against data you want to keep.

## Coverage

### E2E suites

- `test/app.e2e-spec.ts`: health endpoints (`/health/ready` checks configuration, PostgreSQL and Redis; `/health/serving` leaves Redis out) and recovery of the health pool after PostgreSQL terminates its idle connection; no `X-Powered-By` header and a 65 s keep-alive timeout; `X-Correlation-ID` echoed or generated, including on a 413; malformed JSON answered with a generic 400 without parser details; a 200 KB body accepted by the parser.
- `test/payment-intents.e2e-spec.ts`: creation; a missing `Idempotency-Key`; DTO errors with `details`; an oversized body (413); replay with `Idempotent-Replayed: true`; a conflict that creates no second intent; `"125.50"` and `"125.5"` treated as different bodies; concurrent duplicates (one 201, one 200, one intent) and concurrent requests with one key and different bodies (201 and 409).
- `test/webhooks.e2e-spec.ts`: acceptance writes one `RECEIVED` inbox row and one `PENDING` outbox row with `{ webhookEventId }`; an invalid signature (401), a stale timestamp (400), an invalid DTO and an unknown `reference` field (400) write nothing; a duplicate gets `ALREADY_ACCEPTED`; an event ID conflict and a nonce replay get 409; concurrent duplicate deliveries, and concurrent events that share a nonce, leave one inbox row and one outbox row.
- `test/outbox.e2e-spec.ts`: `OutboxDispatcherService` against PostgreSQL and Redis. Publishing creates one job with `{ webhookEventId }`, 5 attempts and exponential backoff from 5 s, and marks the outbox row `PUBLISHED` and the webhook `QUEUED`. A publish failure records `FAILED`, `attempts`, a sanitized `last_error` and a later `next_attempt_at`, and leaves the webhook `RECEIVED`; transient failures stay retryable at 10 attempts; a failed publish ends the batch and leaves the remaining rows for the next run; a poison payload gets `dead_at` and is not selected again; a due retry publishes. Reconciliation hands stale `PUBLISHED` rows back to the dispatcher only while their webhook is `RECEIVED` or `QUEUED`, leaves recent, finished and unpublished rows alone, respects the batch size, and never re-queues a row twice across concurrent runs.
- `test/outbox-runner.e2e-spec.ts`: `WorkerModule` with the runner enabled at a 200 ms interval publishes a `PENDING` row on its own, and the worker drives it to a `CONFIRMED` intent, a `PROCESSED` webhook and a `PUBLISHED` outbox row. A `QUEUED` webhook whose job was lost is recovered end to end after reconciliation.
- `test/worker-bullmq.e2e-spec.ts`: the BullMQ consumer in `WorkerModule` processes a job added to the queue and confirms the payment intent.
- `test/worker-processing.e2e-spec.ts`: `WebhookEventProcessorService` against PostgreSQL, without a queue. A confirmation with a `SUCCEEDED` attempt; a second run returns `already_processed` without side effects; all seven failure reasons (`PAYMENT_INTENT_TERMINAL` through `FAILED` and `EXPIRED` intents); a `PROCESSING` intent is confirmed; an exception at the first write, or at the final attempt insert after the intent was updated, rolls everything back, including the attempt row.
- `test/request-body-guard.e2e-spec.ts`: NUL and escape characters, lone surrogates, nesting deeper than 32 levels, and reserved keys (`__proto__`, `constructor`, `toString`) get 400 `VALIDATION_ERROR` with a correlation ID and write nothing, for JSON and urlencoded bodies; a malformed webhook body is rejected before signature verification; tabs, line breaks, surrogate pairs and the maximum depth are still accepted.
- `test/rate-limit.e2e-spec.ts`: with rate limiting enabled and a limit of 3, the fourth and fifth requests get 429, and health endpoints are not limited. Only the in-memory limiter keyed by the observed client IP is covered.

### Unit suites

- Webhook security helpers: HMAC over timestamp, nonce and raw body; rejection of a changed body and of malformed headers; timestamp format and tolerance.
- Canonical JSON: stable key order, equal hashes for logically equal objects, preserved array order.
- Logging: the field allow-list, stable error codes instead of free-form messages, a numeric `suppressedCount`, and the log throttle.
- Request context and exception filter: accepted, generated and replaced correlation IDs; a generic 400 for parser errors; 503 for PostgreSQL connection failures; body-parser statuses such as 413; a generic 500 that logs only stable codes.
- Database error classification: connection-class SQLSTATEs and socket errors count as unavailable; integrity violations, syntax errors and statement timeouts do not.
- Configuration: URL validation that does not echo credentials, and the rate limiting options.
- Health: controller results; the PostgreSQL probe's isolated pool, statement timeout, handling of idle-client errors and disposal of a failed client; the Redis probe's bounded options, client reuse and replacement.
- Queue publishing: job name, data and options; fail-fast connection options; recreation of the queue with one retry; summarized warnings.
- Outbox runner (`src/outbox/outbox-dispatcher-runner.service.spec.ts`): disabled mode, the interval, the 1 s to 30 s cooldown after failures and its reset, continued polling after a failure, and reconciliation of stale published events.
- Request body guard (`src/common/validation/request-body-guard.middleware.spec.ts`): the depth limit including arrays and a 100,000-level body walked without recursion, control characters and lone surrogates in keys and values, reserved keys at any depth, and the error passed to Express.
- Error diagnostics (`src/common/errors/describe-error.spec.ts`): error name, safe cause code from `driverError`, `cause` or an `AggregateError`, and top stack frames without the message, even a multi-line one. The exception filter spec covers the 5xx diagnostics fields and PostgreSQL data exceptions (SQLSTATE class 22) mapped to 400 `VALIDATION_ERROR` with a warning.
- Redis options (`src/processing/redis-options.spec.ts`): the 5 s command timeout on the publishing connection and none on the worker's blocking connection. The worker spec covers detection of the final BullMQ attempt.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. A single job starts PostgreSQL 16 and Redis 7 as service containers and sets the same values that `test/test-env.ts` uses as defaults, including `WEBHOOK_SECRET=test-webhook-secret-value`. Its steps, in order:

1. `npm ci` on Node 22.
2. Terraform on `infra/terraform`: `fmt -check`, `init -backend=false` and `validate`.
3. `npm run typecheck`
4. `npm run lint`
5. `npm run format:check`
6. `npm test`
7. `npm run test:e2e`
8. `npm run build`
9. `docker compose config`, which validates the Compose file.
10. `docker build` of the production image.
11. The schema drift check, against the database that the e2e step migrated.
12. `npm audit --omit=dev`, which fails on advisories in production dependencies; development-only advisories are not gated.
13. A content policy check over the repository text. It reads its pattern from an Actions secret and is skipped where secrets are not available (Dependabot runs and pull requests from forks).

The same gates, run locally:

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
npm audit --omit=dev
```

Dependabot (`.github/dependabot.yml`) opens grouped weekly pull requests for npm packages (NestJS packages in one group, other production and development dependencies in two more) and for GitHub Actions. Major npm versions are excluded. CI runs on these pull requests.

## Schema drift check

`scripts/check-schema-drift.sh` fails when the TypeORM entities no longer match the migrated schema. It runs `npm run typeorm -- schema:log` against `DATABASE_URL` and passes only when TypeORM reports that the schema is up to date; `schema:log` itself exits with 0 even when it prints synchronization SQL. Run it against a migrated database:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway npm run migration:run
DATABASE_URL=postgres://app:app@localhost:5432/transaction_event_gateway bash scripts/check-schema-drift.sh
```

A failure means that an entity change needs a migration.

## Local smoke check

`npm run smoke:local` runs `scripts/smoke-local.sh` against a running API and worker. It needs `bash`, `curl`, `docker` and `node`, and the Compose `postgres` and `redis` containers, which it queries with `docker compose exec`. The simplest setup is the full Compose stack:

```bash
docker compose up -d --build
npm run smoke:local
```

The script:

1. checks that PostgreSQL and Redis answer and that the migrated tables exist;
2. calls `/health/live`, `/health/ready` and `/docs/openapi.json` (Swagger is served when `NODE_ENV` is not `production`, or with `SWAGGER_ENABLED=true`);
3. creates a payment intent, then checks its replay (200 with `Idempotent-Replayed: true`) and a conflicting request (409);
4. sends a signed webhook, then checks its duplicate (`ALREADY_ACCEPTED`), a bad signature (401) and a stale timestamp (400);
5. waits up to `SMOKE_TIMEOUT_SECONDS` (default 20) until the payment intent is `CONFIRMED`, the webhook `PROCESSED` and the outbox row `PUBLISHED`, with a `SUCCEEDED` processing attempt.

It leaves its rows in place for inspection; their identifiers contain `smoke_`. `SMOKE_BASE_URL` sets the API address (default `http://localhost:3000`). `WEBHOOK_SECRET` must match the API's secret; the default, `local-development-placeholder-secret`, is the one in `docker-compose.yml` and `.env.example`. `SMOKE_POSTGRES_SERVICE`, `SMOKE_POSTGRES_USER`, `SMOKE_POSTGRES_DB` and `SMOKE_REDIS_SERVICE` override the Compose service names, the database user and the database name.
