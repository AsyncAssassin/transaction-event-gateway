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

The service accepts an inbound `X-Correlation-ID` of up to 255 visible ASCII characters (no spaces) and generates a UUID when the header is missing or invalid. Every response, including errors, returns the effective value in `X-Correlation-ID`; error bodies also carry it as `correlationId`.

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

`details` is optional and lists field paths with constraint messages; it does not include secrets, webhook signatures, or raw payloads.

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
- `metadata` is optional, must be a JSON object, and defaults to `{}` when omitted.
- Unknown properties are rejected.
- Invalid values return `400 Bad Request` with `VALIDATION_ERROR` and field-level `details`.

### Error Responses

| Status | Error code | Case |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing or oversized `Idempotency-Key`, invalid JSON, or DTO validation failure (including unknown properties) |
| 409 | `IDEMPOTENCY_CONFLICT` | Same idempotency key was already used with a different logical request payload |
| 413 | `PAYLOAD_TOO_LARGE` | Request body exceeds the configured size limit |
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
- Idempotency keys share one global scope (`payment-intents:create`) because the MVP has no authentication or tenancy. Two unrelated callers that reuse the same key with the same payload receive the same stored response, and with a different payload receive `409`. Isolating keys per caller is future work tied to authentication.
- The request hash is a byte-exact canonicalization (sorted keys) of the logical payload. Numeric strings are not normalized: reusing a key with `"125.50"` and then `"125.5"` is a `409` conflict, so a retried request must send a byte-stable body.

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

1. Require `Content-Type: application/json`.
2. Require the timestamp, nonce (at most 255 characters), and signature headers.
3. Validate the timestamp format and reject timestamps outside the tolerance window (`WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS`, default 300).
4. Validate the `v1=<hex>` signature format.
5. Compute the expected HMAC over the raw request body and compare with timing-safe equality.
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
- `reference` is not part of the signed webhook body; unknown fields are rejected by DTO validation before worker processing.

### Error Responses

| Status | Error code | Case |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing required headers, invalid JSON, or invalid payload shape |
| 401 | `INVALID_WEBHOOK_SIGNATURE` | HMAC verification failed |
| 400 | `STALE_WEBHOOK_TIMESTAMP` | Timestamp is outside the configured tolerance window |
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

## Manual Retry

There is no retry endpoint. Operators re-drive a webhook event that is stuck in `QUEUED` with SQL; see [Re-drive a stuck webhook event](runbook.md#re-drive-a-stuck-webhook-event).

## OpenAPI

Swagger UI is served at `/docs` and the OpenAPI JSON document at `/docs/openapi.json`. Both are enabled outside production; in production they are served only when `SWAGGER_ENABLED=true`.

The generated document lists every operation with its operation ID, summary, required headers (`Idempotency-Key` and the three webhook signature headers), the `CreatePaymentIntentDto` request schema, and status descriptions. It does not yet define response schemas or the webhook request body, because the webhook handler reads the raw body for signature verification; this file is the reference for both.
