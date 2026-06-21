# Implementation Plan

## Overview

This plan keeps implementation incremental and aligned with `docs/architecture.md`. The project has progressed through scaffold, database, payment intents, webhooks, outbox/BullMQ, observability, local operational docs, and an AWS Terraform review scaffold.

The current phase is README and documentation polish. The Terraform scaffold is not a live deployment and still requires approved secrets wiring, private egress review, image publishing, migration execution planning, and explicit apply approval before any AWS use.

## Phase 1: Specs

Deliverables:

- Maintain `docs/architecture.md` as the source architecture document.
- Add focused specs for API, database, testing, failure modes, and implementation phases.
- Keep documentation in English and avoid product claims outside the architecture.

Verification commands:

```bash
ls docs
git status --short
git diff -- docs
```

Non-goals:

- No scaffold.
- No code.
- No package manager setup.
- No Docker setup.

## Phase 2: Scaffold

Deliverables:

- Create the NestJS TypeScript project structure.
- Add package scripts, linting, formatting, Jest, and TypeScript config.
- Add environment validation structure.
- Add empty modules matching the architecture.

Verification commands:

```bash
npm install
npm run lint
npm run test
npm run build
```

Scope guard:

- Do not implement business logic before the persistence and API contracts are clear.
- Do not add real provider integrations.

## Phase 3: Database

Deliverables:

- Configure TypeORM and PostgreSQL connection.
- Create migrations for enum types and the five MVP tables.
- Add indexes, constraints, and foreign keys from `docs/database.md`.
- Add repository access patterns and transaction helpers.

Verification commands:

```bash
npm run migration:run
npm run migration:revert
npm run test:integration
```

Scope guard:

- Do not rely on `synchronize: true` for schema management.
- Do not use Redis for authoritative state.

## Phase 4: Payment Intents

Deliverables:

- Implement `POST /payment-intents`.
- Implement request validation, canonical request hashing, and idempotency records.
- Persist payment intents and response snapshots in one transaction.
- Add unit, integration, and e2e tests for replay and conflict behavior.

Verification commands:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Scope guard:

- Do not implement real funds movement.
- Do not treat `clientRequestId` as a uniqueness or correctness boundary.

## Phase 5: Webhooks

Deliverables:

- Implement `POST /webhooks/blockchain`.
- Validate timestamp, nonce, and HMAC over the raw request body.
- Persist webhook inbox records and outbox records atomically.
- Add duplicate event, nonce replay, stale timestamp, and invalid signature tests.

Verification commands:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Scope guard:

- Do not publish directly to BullMQ during webhook acceptance.
- Do not persist invalid signatures or stale timestamp payloads.

## Phase 6: Outbox + BullMQ

Deliverables:

- Configure Redis and BullMQ.
- Implement outbox dispatcher.
- Publish jobs containing durable IDs only.
- Implement webhook worker transaction boundaries and idempotent processing.
- Record processing attempts.
- Add worker, retry, and concurrency tests.

Verification commands:

```bash
npm run test:worker
npm run test:concurrency
npm run test:integration
```

Scope guard:

- Do not trust business data copied into job payloads.
- Do not depend on BullMQ uniqueness for correctness.

## Phase 7: Observability

Deliverables:

- Add structured logging.
- Add correlation ID propagation.
- Add health endpoints.
- Add basic metrics hooks where practical.
- Ensure logs never include secrets, full signatures, or sensitive raw payloads.

Verification commands:

```bash
npm run test:e2e
npm run lint
```

Scope guard:

- Prometheus and Grafana dashboards can remain optional unless explicitly included in the MVP implementation phase.

## Phase 8: README

Deliverables:

- Document setup, environment variables, local run flow, API examples, and test commands.
- Summarize architecture and failure-mode behavior.
- Include Swagger/OpenAPI location after it exists.

Verification commands:

```bash
npm run build
npm run test
```

Scope guard:

- Keep README operational, concise, and production-oriented.

## Phase 9: Verification

Deliverables:

- Run full automated test suite.
- Run migrations on a clean database.
- Run local stack with API, worker, PostgreSQL, and Redis.
- Exercise payment intent creation, webhook acceptance, duplicate replay, and worker processing.
- Review docs against implementation behavior.

Verification commands:

```bash
npm run lint
npm run build
npm run test
npm run test:integration
npm run test:e2e
npm run test:worker
npm run test:concurrency
docker compose up --build
```

Scope guard:

- Do not mark verification complete if specs, Swagger, README, and implementation behavior disagree.
- Do not commit or push unless explicitly requested in a later phase.
