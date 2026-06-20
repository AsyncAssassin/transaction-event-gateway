import {
  createWebhookSignature,
  hasValidWebhookSignatureFormat,
  verifyWebhookSignature,
} from './webhook-signature';

describe('webhook signature helpers', () => {
  const secret = 'unit-test-webhook-secret';
  const timestamp = '1781850000';
  const nonce = 'nonce_123';
  const rawBody = Buffer.from(
    '{"eventId":"evt_123","type":"transaction.confirmed"}',
  );

  it('creates and verifies an HMAC signature over timestamp, nonce, and raw body', () => {
    const signature = createWebhookSignature({
      secret,
      timestamp,
      nonce,
      rawBody,
    });

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        nonce,
        rawBody,
        signatureHeader: signature,
      }),
    ).toBe(true);
  });

  it('rejects a signature when the raw body changes', () => {
    const signature = createWebhookSignature({
      secret,
      timestamp,
      nonce,
      rawBody,
    });

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        nonce,
        rawBody: Buffer.from(rawBody.toString('utf8').replace('123', '456')),
        signatureHeader: signature,
      }),
    ).toBe(false);
  });

  it('rejects malformed signature headers', () => {
    expect(hasValidWebhookSignatureFormat('v1=not-hex')).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        nonce,
        rawBody,
        signatureHeader: 'v1=not-hex',
      }),
    ).toBe(false);
  });
});
