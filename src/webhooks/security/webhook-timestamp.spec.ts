import { validateWebhookTimestamp } from './webhook-timestamp';

describe('webhook timestamp helper', () => {
  const nowMs = 1_781_850_000_000;

  it('accepts a Unix timestamp inside tolerance', () => {
    expect(validateWebhookTimestamp('1781849850', 300, nowMs)).toEqual({
      ok: true,
      timestampSeconds: 1_781_849_850,
    });
  });

  it('rejects a malformed timestamp', () => {
    expect(validateWebhookTimestamp('1781850000.5', 300, nowMs)).toEqual({
      ok: false,
      reason: 'INVALID_FORMAT',
    });
  });

  it('rejects a timestamp outside tolerance', () => {
    expect(validateWebhookTimestamp('1781849000', 300, nowMs)).toEqual({
      ok: false,
      reason: 'OUTSIDE_TOLERANCE',
    });
  });
});
