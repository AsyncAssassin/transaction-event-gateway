# AWS Deployed Smoke Test Flow

## Metadata

| Field | Value |
| --- | --- |
| Status | Documentation-only flow, not executed |
| Scope | Future approval-gated smoke test after AWS migration, API, and worker rollout |
| Last updated | 2026-06-22 |

## Current Phase Status

This document records the intended smoke test flow for a future deployed AWS
environment. It does not approve a live AWS operation, does not run a smoke
test, does not call AWS APIs, does not add automation, and does not prove that
any deployed API exists.

All command examples below are future approval-gated examples only. Do not run
them in this docs-only phase. They intentionally use placeholders instead of a
real deployed URL, account-specific values, ARNs, credentials, tokens, or
secrets.

## Required Prerequisites

Run the deployed smoke test only after all of these are true for the target
environment:

- Live AWS usage has explicit approval under
  [AWS deploy guardrails](aws-deploy-guardrails.md).
- The approved image was published through
  [ECR image publishing path](ecr-image-publishing.md), and the immutable image
  tag or digest is recorded.
- Runtime secrets are populated through an approved out-of-git process,
  including `DATABASE_URL`, `REDIS_URL`, and `WEBHOOK_SECRET`.
- Private ECS egress prerequisites are satisfied, including approved VPC,
  subnet, private route table, and endpoint inputs or an explicitly approved
  alternative.
- Terraform state owner and backend configuration are approved before any live
  infrastructure operation.
- The one-off migration task flow in
  [One-off ECS migration task flow](aws-migration-task-flow.md) completed
  successfully and the migration result record is available.
- API and worker services have rolled to the approved task definitions.
- The deployed API base URL is approved for smoke testing and is recorded only
  in the target environment's deployment notes, not committed into this
  repository.
- The environment owner has confirmed the teardown timebox or rollback decision
  path before the smoke starts.

If any prerequisite is missing, do not start the deployed smoke test.

## Inputs to Record Before Running

Record these values in the deployment notes for the target environment before
the first request:

- Deployed API base URL placeholder: `<DEPLOYED_API_BASE_URL>`.
- Approved image tag or digest.
- Reviewed commit SHA.
- Migration result record reference.
- Target environment and region.
- Operator.
- Approval reference for the smoke run.
- Start timestamp.
- Expected teardown timebox or rollback decision owner.

Do not record secrets, credentials, tokens, database URLs, Redis URLs, account
IDs, or real ARNs in committed repository files.

## Future Approved Request Flow

Use a unique correlation ID and idempotency key for each smoke attempt. The
examples are written as manual operator commands so the values can be reviewed
before execution.

```bash
# Future approval-gated example only. Do not run in this docs-only phase.
DEPLOYED_API_BASE_URL="<DEPLOYED_API_BASE_URL>"
SMOKE_ID="smoke-approved-$(date +%s)"
```

### 1. Verify Liveness

```bash
# Future approval-gated example only. Do not run in this docs-only phase.
curl -i "${DEPLOYED_API_BASE_URL}/health/live" \
  -H "X-Correlation-ID: ${SMOKE_ID}-live"
```

Pass criteria:

- HTTP status is `200`.
- Response body reports `status: "ok"`.
- Response includes or logs the supplied correlation ID.

Fail criteria:

- Connection fails, times out, returns a non-`200` status, or returns a body
  that does not report healthy liveness.

### 2. Verify Readiness

```bash
# Future approval-gated example only. Do not run in this docs-only phase.
curl -i "${DEPLOYED_API_BASE_URL}/health/ready" \
  -H "X-Correlation-ID: ${SMOKE_ID}-ready"
```

Pass criteria:

- HTTP status is `200`.
- Response body reports `status: "ok"`.
- Configuration, PostgreSQL, and Redis checks are all healthy.

Fail criteria:

- Any non-`200` response.
- Any readiness dependency reports unhealthy or is missing from the response.
- Readiness flaps during the smoke window.

### 3. Create a Minimal Payment Intent

```bash
# Future approval-gated example only. Do not run in this docs-only phase.
curl -i "${DEPLOYED_API_BASE_URL}/payment-intents" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${SMOKE_ID}-payment-intent" \
  -H "X-Correlation-ID: ${SMOKE_ID}-payment-create" \
  -d '{
    "amount": "125.50",
    "asset": "USDC",
    "destination": "wallet_smoke_approved",
    "reference": "order_smoke_approved",
    "clientRequestId": "client_smoke_approved",
    "metadata": {
      "smokeId": "approved-deployed-smoke"
    }
  }'
```

Pass criteria:

- HTTP status is `201 Created`.
- Response body includes a non-empty payment intent ID.
- Response body status is `CREATED`.
- The operator records the ID as `<PAYMENT_INTENT_ID>` for the webhook step.

Fail criteria:

- Request is rejected, times out, returns validation errors, or does not include
  a usable payment intent ID.
- Any idempotency conflict occurs with the unique smoke key.

### 4. Send a Signed Blockchain Webhook

Use only an approved non-production webhook secret retrieved through the
approved secret store access process for the target environment. Do not paste
the secret into committed files or deployment notes.

```bash
# Future approval-gated example only. Do not run in this docs-only phase.
WEBHOOK_SECRET="<WEBHOOK_SECRET_FROM_APPROVED_SECRET_STORE>"
PAYMENT_INTENT_ID="<PAYMENT_INTENT_ID>"
WEBHOOK_TIMESTAMP="$(date +%s)"
WEBHOOK_NONCE="${SMOKE_ID}-nonce"
WEBHOOK_BODY="$(
  node -e '
const [smokeId, paymentIntentId] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  eventId: `evt_${smokeId}`,
  type: "transaction.confirmed",
  paymentIntentId,
  txHash: `0x${smokeId}`,
  amount: "125.50",
  asset: "USDC"
}));
' "$SMOKE_ID" "$PAYMENT_INTENT_ID"
)"
WEBHOOK_SIGNATURE="$(
  node -e '
const crypto = require("node:crypto");
const [secret, timestamp, nonce, body] = process.argv.slice(1);
const hmac = crypto.createHmac("sha256", secret);
hmac.update(timestamp, "utf8");
hmac.update(".", "utf8");
hmac.update(nonce, "utf8");
hmac.update(".", "utf8");
hmac.update(body);
process.stdout.write(`v1=${hmac.digest("hex")}`);
' "$WEBHOOK_SECRET" "$WEBHOOK_TIMESTAMP" "$WEBHOOK_NONCE" "$WEBHOOK_BODY"
)"

curl -i "${DEPLOYED_API_BASE_URL}/webhooks/blockchain" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Timestamp: ${WEBHOOK_TIMESTAMP}" \
  -H "X-Webhook-Nonce: ${WEBHOOK_NONCE}" \
  -H "X-Webhook-Signature: ${WEBHOOK_SIGNATURE}" \
  -H "X-Correlation-ID: ${SMOKE_ID}-webhook" \
  -d "${WEBHOOK_BODY}"
```

Pass criteria:

- HTTP status is `202 Accepted`.
- Response body reports `status: "ACCEPTED"` or an equivalent accepted status.
- The request can be correlated in API logs by `X-Correlation-ID` without
  exposing the secret or raw signature.

Fail criteria:

- Signature validation fails.
- Timestamp is stale.
- Nonce replay or event conflict occurs for the unique smoke values.
- API logs expose webhook secrets, full signatures, raw bodies, credentials, or
  other sensitive data.

### 5. Verify Asynchronous Processing Evidence

The application does not currently expose a read API for payment intent or
webhook processing state. Therefore, asynchronous evidence must come from the
approved operational inspection path for the target environment.

Acceptable evidence, when approved for the environment:

- API log entry for webhook acceptance with the smoke correlation ID.
- Worker log entry showing the matching webhook event was processed
  successfully.
- Approved database inspection showing the payment intent reached
  `CONFIRMED`, the webhook event reached `PROCESSED`, the outbox row reached
  `PUBLISHED`, and a successful processing attempt exists.

Pass criteria:

- At least one approved evidence path confirms the webhook-to-worker flow
  completed successfully.
- Evidence uses safe identifiers only and does not expose secrets, credentials,
  account IDs, real ARNs, or raw sensitive payloads.

Fail criteria:

- No approved evidence path exists.
- Evidence is inconclusive before the smoke timeout.
- Worker processing fails, stalls, or cannot be correlated to the smoke request.
- Any inspection process requires unapproved credentials, unapproved AWS API
  usage, or committing sensitive values.

## Result Record

After the smoke attempt, record the result in deployment notes for the target
environment:

- Deployed API base URL placeholder: `<DEPLOYED_API_BASE_URL>`.
- Approved image tag or digest.
- Reviewed commit SHA.
- Migration result record reference.
- Operator.
- Approval reference.
- Start and finish timestamp.
- Liveness result.
- Readiness result.
- Payment intent creation result and `<PAYMENT_INTENT_ID>`.
- Webhook acceptance result.
- Async processing evidence used.
- Final decision: pass or fail.
- Follow-up decision: continue observation, stop rollout, rollback, scale down,
  or tear down within the approved timebox.

Do not commit the result record if it contains real environment identifiers,
real deployed URLs, account IDs, ARNs, credentials, tokens, secret values,
database URLs, Redis URLs, or sensitive payloads.

## Failure Handling

On any failed or inconclusive smoke result:

- Stop the rollout and do not promote the environment.
- Keep the environment inside the approved timebox while evidence is collected.
- Preserve approved logs and safe request identifiers for diagnosis.
- Decide explicitly whether to retry, roll back to the previous API and worker
  task definitions, scale down, or tear down.
- Do not run additional live AWS, deployment, migration, or destructive
  operations without separate explicit approval.
- Do not treat a partial health-only pass as proof that payment intent,
  webhook, outbox, and worker processing are healthy.

## Relationship to Local Smoke

`npm run smoke:local` remains the local Docker Compose smoke test documented in
[Testing strategy](testing.md) and [Operational runbook](runbook.md). It uses
local PostgreSQL and Redis inspection and is not a deployed AWS smoke test.

This deployed flow is intentionally manual and approval-gated. Do not point the
local smoke script at a real deployed AWS URL unless a separate future phase
approves that behavior and its data, credential, and observability boundaries.

## Explicit Non-Goals

- No smoke test was run by this document.
- No live AWS command is approved by this document.
- No deployed API URL is provided or verified by this document.
- No Terraform `plan`, `apply`, `destroy`, or `import` is approved by this
  document.
- No registry authentication, image push, task runner, deploy workflow, shell
  script, package script, GitHub Actions workflow, or AWS CLI automation is
  added by this document.
- No real URLs, account IDs, ARNs, credentials, tokens, database URLs, Redis
  URLs, webhook secrets, or secret values should be committed as part of this
  flow.
