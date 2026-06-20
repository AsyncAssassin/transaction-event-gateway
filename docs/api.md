# API Specification

## Overview

The API exposes payment intent creation and signed blockchain webhook acceptance for the MVP backend service. PostgreSQL remains the durable source of truth for idempotency, webhook inbox records, and processing state. Redis/BullMQ is used only after accepted webhook events are durably written through the outbox flow.

All request and response bodies use JSON. All timestamps in responses are ISO 8601 UTC strings.

## Common Headers

Required for JSON requests:

```http
Content-Type: application/json
```

Recommended for all requests:

```http
X-Correlation-ID: request-123
```

The service should accept an inbound `X-Correlation-ID` or generate one when missing. Responses should include the effective correlation ID.

## Error Response Shape

Use a stable error envelope:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "details": [
    {
      "field": "amount",
      "message": "amount must be greater than zero"
    }
  ],
  "correlationId": "request-123"
}
```

`details` is optional and should not include secrets, full webhook signatures, or sensitive raw payloads.

## POST /payment-intents

Creates a payment intent idempotently.

### Required Headers

```http
Content-Type: application/json
Idempotency-Key: 01JABCEXAMPLE
```

### Request

```json
{
  "amount": "125.50",
  "asset": "USDC",
  "destination": "wallet_test_123",
  "reference": "order-1001",
  "clientRequestId": "checkout-1001",
  "metadata": {
    "customerId": "cust_123"
  }
}
```

### Success Response

`201 Created`

```json
{
  "id": "5f70a0c2-7bb5-4545-b181-3fcff9b56b86",
  "status": "CREATED",
  "amount": "125.50",
  "asset": "USDC",
  "destination": "wallet_test_123",
  "reference": "order-1001",
  "clientRequestId": "checkout-1001",
  "createdAt": "2026-06-19T10:00:00.000Z"
}
```

### Idempotent Replay Response

Same `Idempotency-Key`, same logical payload:

```http
HTTP/1.1 200 OK
Idempotent-Replayed: true
Content-Type: application/json
```

```json
{
  "id": "5f70a0c2-7bb5-4545-b181-3fcff9b56b86",
  "status": "CREATED",
  "amount": "125.50",
  "asset": "USDC",
  "destination": "wallet_test_123",
  "reference": "order-1001",
  "clientRequestId": "checkout-1001",
  "createdAt": "2026-06-19T10:00:00.000Z"
}
```

### Validation Rules

- `Idempotency-Key` is required, non-empty, and limited to 255 characters.
- Request body must be valid JSON.
- `amount` is required and represented as a decimal string.
- `amount` must be greater than zero and fit the database precision `numeric(36, 18)`.
- `asset` is required, uppercase, and limited to 32 characters.
- `destination` is required and limited to 255 characters.
- `reference` is optional and limited to 255 characters.
- `clientRequestId` is optional and limited to 255 characters.
- `metadata` is optional from the caller perspective and defaults to `{}` when omitted.
- Unsupported assets, invalid amount semantics, or invalid destination semantics return `422 Unprocessable Entity`.

### Error Responses

| Status | Error code | Case |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing `Idempotency-Key`, invalid JSON, or DTO validation failure |
| 409 | `IDEMPOTENCY_CONFLICT` | Same idempotency key was already used with a different logical request payload |
| 422 | `UNPROCESSABLE_PAYMENT_INTENT` | Unsupported asset, invalid amount, or invalid destination |
| 503 | `SERVICE_UNAVAILABLE` | PostgreSQL is unavailable |

Conflict example:

```json
{
  "error": "IDEMPOTENCY_CONFLICT",
  "message": "The provided Idempotency-Key was already used with a different request payload."
}
```

### Idempotency Behavior

Scope:

```text
payment-intents:create
```

The service canonicalizes the logical request body, hashes it with SHA-256, and stores the hash in `idempotency_records` inside the same transaction that creates `payment_intents`.

Rules:

- Same key and same payload returns the stored response and does not create another payment intent.
- Same key and different payload returns `409 Conflict` and does not mutate the original payment intent.
- The database unique constraint on `(scope, idempotency_key)` is the concurrency guard.
- The response snapshot must be stored before the transaction commits.
- Idempotency correctness must not depend on Redis, in-memory locks, or queue uniqueness.

## POST /webhooks/blockchain

Accepts a signed external blockchain or payment event from the mocked webhook provider contract.

### Required Headers

```http
Content-Type: application/json
X-Webhook-Timestamp: 1781850000
X-Webhook-Nonce: nonce_123
X-Webhook-Signature: v1=3d7a...
```

### Signature Behavior

The HMAC must be computed over the raw request body bytes:

```text
signed_payload = timestamp + "." + nonce + "." + raw_request_body
signature = HMAC_SHA256(webhook_secret, signed_payload)
header = X-Webhook-Signature: v1=<hex_signature>
```

Validation order:

1. Require timestamp, nonce, and signature headers.
2. Validate timestamp format.
3. Reject timestamps outside the configured 5 minute tolerance window.
4. Compute the expected HMAC using the raw request body.
5. Compare signatures with timing-safe equality.
6. Validate the JSON payload DTO.
7. Persist the webhook inbox row and outbox row in one PostgreSQL transaction.

The payload is not persisted and no outbox event is created when signature validation, timestamp validation, or DTO validation fails.

### Request

```json
{
  "eventId": "evt_123",
  "type": "transaction.confirmed",
  "paymentIntentId": "5f70a0c2-7bb5-4545-b181-3fcff9b56b86",
  "txHash": "0xtest123",
  "amount": "125.50",
  "asset": "USDC"
}
```

### Success Response

`202 Accepted`

```json
{
  "eventId": "evt_123",
  "status": "ACCEPTED"
}
```

### Duplicate Identical Webhook Response

`202 Accepted`

```json
{
  "eventId": "evt_123",
  "status": "ALREADY_ACCEPTED"
}
```

### Validation Rules

- `X-Webhook-Timestamp` is required and must be a Unix timestamp.
- `X-Webhook-Nonce` is required and limited to 255 characters.
- `X-Webhook-Signature` is required and must use the `v1=<hex>` format.
- Timestamp must be inside the configured tolerance window.
- Signature must match the HMAC over timestamp, nonce, and raw request body.
- `eventId` is required and limited to 255 characters.
- `type` is required and limited to 128 characters.
- `paymentIntentId` is required for MVP processing events and must be a UUID.
- `txHash` is optional at transport level but required for confirmed transaction events.
- `amount` and `asset` must match the referenced payment intent during worker processing.

### Error Responses

| Status | Error code | Case |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing required headers, invalid JSON, or invalid payload shape |
| 401 | `INVALID_WEBHOOK_SIGNATURE` | HMAC verification failed |
| 408 | `STALE_WEBHOOK_TIMESTAMP` | Timestamp is outside the configured tolerance window |
| 409 | `WEBHOOK_EVENT_CONFLICT` | Same provider event ID was seen with a different payload hash |
| 409 | `WEBHOOK_NONCE_REPLAY` | Same provider nonce was reused with a different event |
| 503 | `SERVICE_UNAVAILABLE` | PostgreSQL is unavailable |

### Webhook Idempotency Behavior

Deduplication keys:

- `provider + external_event_id`
- `provider + nonce`

Rules:

- Same provider event ID and same payload hash returns an idempotent accepted response.
- Same provider event ID and different payload hash returns `409 Conflict`.
- Same provider nonce reused for a different event returns `409 Conflict`.
- Accepted events are written to `webhook_events` before any asynchronous processing.
- The API inserts an `outbox_events` row in the same transaction as the webhook inbox row.
- The API does not publish directly to BullMQ during webhook acceptance.

## POST /webhook-events/{id}/retry

Optional / MVP-later endpoint for manually retrying failed webhook processing. The MVP can defer this endpoint until the core worker and outbox flow exist.

### Required Headers

```http
Content-Type: application/json
```

Authentication and authorization are outside the MVP scope. When this endpoint is implemented beyond MVP, it must require operator authorization.

### Request

```json
{
  "reason": "manual operational retry after transient dependency failure"
}
```

### Success Response

`202 Accepted`

```json
{
  "webhookEventId": "9d55ebac-758c-4a9c-8237-25ad37e78c64",
  "status": "QUEUED"
}
```

### Rules

- Only `FAILED` webhook events can be manually retried.
- Manual retry must not modify the original webhook payload.
- Retry should create a new outbox event or BullMQ job for the existing durable webhook event.
- Retry reason should be recorded when the endpoint exists.

### Error Responses

| Status | Error code | Case |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid UUID or invalid request body |
| 404 | `WEBHOOK_EVENT_NOT_FOUND` | No webhook event exists for the supplied ID |
| 409 | `WEBHOOK_EVENT_NOT_RETRYABLE` | Event is not in `FAILED` status |
| 503 | `SERVICE_UNAVAILABLE` | PostgreSQL or required queue infrastructure is unavailable |

## OpenAPI / Swagger Expectations

The NestJS implementation should expose Swagger/OpenAPI documentation for MVP endpoints.

Required documentation:

- Path, method, summary, and operation ID for every endpoint.
- Header parameters for `Idempotency-Key`, `X-Correlation-ID`, and webhook signature headers.
- Request DTO schemas with examples.
- Response schemas for success, replay, conflict, validation, unauthorized, timeout, and service unavailable cases.
- Enum schemas for payment intent and webhook statuses.
- `Idempotent-Replayed` response header on replayed `POST /payment-intents` calls.
- Security notes explaining that webhook signatures are computed over the raw body and are not derived from parsed JSON.
- Clear marking of `POST /webhook-events/{id}/retry` as optional / MVP-later if it is not included in the initial route set.
