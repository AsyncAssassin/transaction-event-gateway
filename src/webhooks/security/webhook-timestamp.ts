export type WebhookTimestampValidationResult =
  | {
      ok: true;
      timestampSeconds: number;
    }
  | {
      ok: false;
      reason: 'INVALID_FORMAT' | 'OUTSIDE_TOLERANCE';
    };

export function validateWebhookTimestamp(
  timestamp: string,
  toleranceSeconds: number,
  nowMs = Date.now(),
): WebhookTimestampValidationResult {
  if (!/^\d+$/.test(timestamp)) {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
    };
  }

  const timestampSeconds = Number(timestamp);

  if (!Number.isSafeInteger(timestampSeconds)) {
    return {
      ok: false,
      reason: 'INVALID_FORMAT',
    };
  }

  const deltaMs = Math.abs(nowMs - timestampSeconds * 1000);

  if (deltaMs > toleranceSeconds * 1000) {
    return {
      ok: false,
      reason: 'OUTSIDE_TOLERANCE',
    };
  }

  return {
    ok: true,
    timestampSeconds,
  };
}
