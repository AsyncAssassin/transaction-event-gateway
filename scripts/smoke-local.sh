#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-${BASE_URL:-http://localhost:3000}}"
BASE_URL="${BASE_URL%/}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-test-webhook-secret-value}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-20}"
SMOKE_POSTGRES_SERVICE="${SMOKE_POSTGRES_SERVICE:-postgres}"
SMOKE_POSTGRES_USER="${SMOKE_POSTGRES_USER:-app}"
SMOKE_POSTGRES_DB="${SMOKE_POSTGRES_DB:-transaction_event_gateway}"
SMOKE_REDIS_SERVICE="${SMOKE_REDIS_SERVICE:-redis}"

COMPOSE=(docker compose)
TMP_DIR="$(mktemp -d)"
SMOKE_ID="smoke_$(date +%s)_$RANDOM"
IDEMPOTENCY_KEY="${SMOKE_ID}_payment_intent"
WEBHOOK_EVENT_ID="evt_${SMOKE_ID}"
WEBHOOK_NONCE="nonce_${SMOKE_ID}"
WEBHOOK_TX_HASH="0x${SMOKE_ID}"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

log() {
  printf '[smoke] %s\n' "$*"
}

fail() {
  printf '[smoke] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name="$1"

  command -v "$command_name" >/dev/null 2>&1 ||
    fail "$command_name is required but was not found in PATH."
}

run_sql() {
  local sql="$1"

  "${COMPOSE[@]}" exec -T "$SMOKE_POSTGRES_SERVICE" \
    psql -U "$SMOKE_POSTGRES_USER" -d "$SMOKE_POSTGRES_DB" \
    -v ON_ERROR_STOP=1 -tAc "$sql"
}

expect_sql() {
  local sql="$1"
  local expected="$2"
  local actual

  actual="$(run_sql "$sql" | tr -d '\r')"
  [[ "$actual" == "$expected" ]] ||
    fail "Unexpected SQL result. Expected '$expected', got '$actual'."
}

request() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local body_file="$4"
  local headers_file="$5"
  shift 5

  local status
  if ! status="$(
    curl -sS \
      -o "$body_file" \
      -D "$headers_file" \
      -w '%{http_code}' \
      -X "$method" \
      "$BASE_URL$path" \
      "$@"
  )"; then
    fail "$method $path failed to connect to $BASE_URL."
  fi

  if [[ "$status" != "$expected_status" ]]; then
    printf '[smoke] Unexpected response body:\n' >&2
    head -c 1200 "$body_file" >&2 || true
    printf '\n' >&2
    fail "$method $path returned $status, expected $expected_status."
  fi
}

assert_json_field() {
  local file="$1"
  local field="$2"
  local expected="$3"

  node -e '
const fs = require("node:fs");
const [file, field, expected] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const actual = field.split(".").reduce((value, key) => value?.[key], data);
if (String(actual) !== expected) {
  console.error(`Expected ${field}=${expected}, got ${String(actual)}`);
  process.exit(1);
}
' "$file" "$field" "$expected" ||
    fail "Unexpected JSON response field '$field'."
}

extract_json_string() {
  local file="$1"
  local field="$2"

  node -e '
const fs = require("node:fs");
const [file, field] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const value = field.split(".").reduce((current, key) => current?.[key], data);
if (typeof value !== "string" || value.length === 0) {
  console.error(`Missing string field: ${field}`);
  process.exit(1);
}
process.stdout.write(value);
' "$file" "$field"
}

create_signature() {
  local timestamp="$1"
  local nonce="$2"
  local body="$3"

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
' "$WEBHOOK_SECRET" "$timestamp" "$nonce" "$body"
}

build_payment_body() {
  node -e '
const [smokeId] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  amount: "125.50",
  asset: "USDC",
  destination: `wallet_${smokeId}`,
  reference: `order_${smokeId}`,
  clientRequestId: `client_${smokeId}`,
  metadata: { smokeId }
}));
' "$SMOKE_ID"
}

build_conflicting_payment_body() {
  node -e '
const [smokeId] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  amount: "126.50",
  asset: "USDC",
  destination: `wallet_${smokeId}`,
  reference: `order_${smokeId}`,
  clientRequestId: `client_${smokeId}`,
  metadata: { smokeId }
}));
' "$SMOKE_ID"
}

build_webhook_body() {
  local event_id="$1"
  local payment_intent_id="$2"
  local tx_hash="$3"

  node -e '
const [eventId, paymentIntentId, txHash] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  eventId,
  type: "transaction.confirmed",
  paymentIntentId,
  txHash,
  amount: "125.50",
  asset: "USDC"
}));
' "$event_id" "$payment_intent_id" "$tx_hash"
}

wait_for_worker_completion() {
  local payment_intent_id="$1"
  local deadline=$((SECONDS + SMOKE_TIMEOUT_SECONDS))
  local expected="CONFIRMED|${WEBHOOK_TX_HASH}|PROCESSED|PUBLISHED|1"
  local actual=""

  while ((SECONDS < deadline)); do
    actual="$(
      run_sql "
        SELECT concat_ws(
          '|',
          pi.status,
          COALESCE(pi.confirmed_tx_hash, ''),
          we.status,
          oe.status,
          CASE WHEN COUNT(wpa.id) FILTER (WHERE wpa.status = 'SUCCEEDED') > 0 THEN '1' ELSE '0' END
        )
        FROM payment_intents pi
        JOIN webhook_events we ON we.payment_intent_id = pi.id
        JOIN outbox_events oe ON oe.aggregate_id = we.id
        LEFT JOIN webhook_processing_attempts wpa ON wpa.webhook_event_id = we.id
        WHERE pi.id = '${payment_intent_id}'
          AND we.provider = 'blockchain'
          AND we.external_event_id = '${WEBHOOK_EVENT_ID}'
        GROUP BY pi.status, pi.confirmed_tx_hash, we.status, oe.status
      " | tr -d '\r'
    )"

    if [[ "$actual" == "$expected" ]]; then
      return 0
    fi

    sleep 1
  done

  fail "Worker did not complete within ${SMOKE_TIMEOUT_SECONDS}s. Last DB state: '${actual:-no rows}'."
}

require_command bash
require_command curl
require_command docker
require_command node

"${COMPOSE[@]}" version >/dev/null ||
  fail "docker compose is required."

log "Checking local infrastructure"
"${COMPOSE[@]}" exec -T "$SMOKE_POSTGRES_SERVICE" \
  pg_isready -U "$SMOKE_POSTGRES_USER" -d "$SMOKE_POSTGRES_DB" >/dev/null ||
  fail "PostgreSQL service '$SMOKE_POSTGRES_SERVICE' is not ready."

"${COMPOSE[@]}" exec -T "$SMOKE_REDIS_SERVICE" redis-cli ping |
  grep -q '^PONG$' ||
  fail "Redis service '$SMOKE_REDIS_SERVICE' is not ready."

expect_sql "
  SELECT bool_and(to_regclass(required_table) IS NOT NULL)
  FROM (
    VALUES
      ('public.payment_intents'),
      ('public.idempotency_records'),
      ('public.webhook_events'),
      ('public.outbox_events'),
      ('public.webhook_processing_attempts')
  ) AS required(required_table)
" "t"

log "Checking API readiness at $BASE_URL"
request GET /health/live 200 "$TMP_DIR/live.json" "$TMP_DIR/live.headers"
request GET /health/ready 200 "$TMP_DIR/ready.json" "$TMP_DIR/ready.headers"
request GET /docs/openapi.json 200 "$TMP_DIR/openapi.json" "$TMP_DIR/openapi.headers"

log "Creating payment intent with idempotency key $IDEMPOTENCY_KEY"
PAYMENT_BODY="$(build_payment_body)"
PAYMENT_CONFLICT_BODY="$(build_conflicting_payment_body)"

request POST /payment-intents 201 "$TMP_DIR/payment-create.json" "$TMP_DIR/payment-create.headers" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H "X-Correlation-ID: ${SMOKE_ID}_create" \
  --data "$PAYMENT_BODY"

assert_json_field "$TMP_DIR/payment-create.json" status CREATED
PAYMENT_INTENT_ID="$(extract_json_string "$TMP_DIR/payment-create.json" id)"

log "Verifying idempotent replay"
request POST /payment-intents 200 "$TMP_DIR/payment-replay.json" "$TMP_DIR/payment-replay.headers" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H "X-Correlation-ID: ${SMOKE_ID}_replay" \
  --data "$PAYMENT_BODY"

grep -qi '^Idempotent-Replayed:[[:space:]]*true[[:space:]]*$' "$TMP_DIR/payment-replay.headers" ||
  fail "Idempotent-Replayed: true header was not present on replay."
assert_json_field "$TMP_DIR/payment-replay.json" id "$PAYMENT_INTENT_ID"

log "Verifying idempotency conflict"
request POST /payment-intents 409 "$TMP_DIR/payment-conflict.json" "$TMP_DIR/payment-conflict.headers" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H "X-Correlation-ID: ${SMOKE_ID}_conflict" \
  --data "$PAYMENT_CONFLICT_BODY"

log "Sending signed webhook"
WEBHOOK_BODY="$(build_webhook_body "$WEBHOOK_EVENT_ID" "$PAYMENT_INTENT_ID" "$WEBHOOK_TX_HASH")"
WEBHOOK_TIMESTAMP="$(date +%s)"
WEBHOOK_SIGNATURE="$(create_signature "$WEBHOOK_TIMESTAMP" "$WEBHOOK_NONCE" "$WEBHOOK_BODY")"

request POST /webhooks/blockchain 202 "$TMP_DIR/webhook-accepted.json" "$TMP_DIR/webhook-accepted.headers" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $WEBHOOK_TIMESTAMP" \
  -H "X-Webhook-Nonce: $WEBHOOK_NONCE" \
  -H "X-Webhook-Signature: $WEBHOOK_SIGNATURE" \
  -H "X-Correlation-ID: ${SMOKE_ID}_webhook" \
  --data "$WEBHOOK_BODY"

assert_json_field "$TMP_DIR/webhook-accepted.json" status ACCEPTED

log "Verifying duplicate webhook acceptance"
request POST /webhooks/blockchain 202 "$TMP_DIR/webhook-duplicate.json" "$TMP_DIR/webhook-duplicate.headers" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $WEBHOOK_TIMESTAMP" \
  -H "X-Webhook-Nonce: $WEBHOOK_NONCE" \
  -H "X-Webhook-Signature: $WEBHOOK_SIGNATURE" \
  -H "X-Correlation-ID: ${SMOKE_ID}_webhook_duplicate" \
  --data "$WEBHOOK_BODY"

assert_json_field "$TMP_DIR/webhook-duplicate.json" status ALREADY_ACCEPTED

log "Verifying webhook signature rejection"
BAD_SIGNATURE_BODY="$(build_webhook_body "evt_${SMOKE_ID}_bad_sig" "$PAYMENT_INTENT_ID" "0x${SMOKE_ID}_bad_sig")"
BAD_SIGNATURE_TIMESTAMP="$(date +%s)"
request POST /webhooks/blockchain 401 "$TMP_DIR/webhook-bad-signature.json" "$TMP_DIR/webhook-bad-signature.headers" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $BAD_SIGNATURE_TIMESTAMP" \
  -H "X-Webhook-Nonce: nonce_${SMOKE_ID}_bad_sig" \
  -H "X-Webhook-Signature: v1=0000000000000000000000000000000000000000000000000000000000000000" \
  -H "X-Correlation-ID: ${SMOKE_ID}_bad_signature" \
  --data "$BAD_SIGNATURE_BODY"

log "Verifying stale webhook timestamp rejection"
STALE_BODY="$(build_webhook_body "evt_${SMOKE_ID}_stale" "$PAYMENT_INTENT_ID" "0x${SMOKE_ID}_stale")"
STALE_TIMESTAMP="$(( $(date +%s) - 86400 ))"
STALE_NONCE="nonce_${SMOKE_ID}_stale"
STALE_SIGNATURE="$(create_signature "$STALE_TIMESTAMP" "$STALE_NONCE" "$STALE_BODY")"

request POST /webhooks/blockchain 408 "$TMP_DIR/webhook-stale.json" "$TMP_DIR/webhook-stale.headers" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $STALE_TIMESTAMP" \
  -H "X-Webhook-Nonce: $STALE_NONCE" \
  -H "X-Webhook-Signature: $STALE_SIGNATURE" \
  -H "X-Correlation-ID: ${SMOKE_ID}_stale" \
  --data "$STALE_BODY"

log "Waiting for worker and outbox completion"
wait_for_worker_completion "$PAYMENT_INTENT_ID"

log "Smoke check passed for $SMOKE_ID"
