export function setTestEnvDefaults(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.PORT ??= '3000';
  process.env.DATABASE_URL ??=
    'postgres://app:app@localhost:5432/transaction_event_gateway';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.WEBHOOK_SECRET ??= 'test-webhook-secret-value';
  process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS ??= '300';
  process.env.OUTBOX_DISPATCH_ENABLED ??= 'false';
  process.env.OUTBOX_DISPATCH_INTERVAL_MS ??= '1000';
}
