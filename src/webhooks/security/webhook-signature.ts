import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_PREFIX = 'v1=';

type RawWebhookBody = Buffer | string;

export type CreateWebhookSignatureInput = {
  secret: string;
  timestamp: string;
  nonce: string;
  rawBody: RawWebhookBody;
};

export type VerifyWebhookSignatureInput = CreateWebhookSignatureInput & {
  signatureHeader: string;
};

export function createWebhookSignature({
  secret,
  timestamp,
  nonce,
  rawBody,
}: CreateWebhookSignatureInput): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(timestamp, 'utf8');
  hmac.update('.', 'utf8');
  hmac.update(nonce, 'utf8');
  hmac.update('.', 'utf8');
  hmac.update(rawBody);

  return `${WEBHOOK_SIGNATURE_PREFIX}${hmac.digest('hex')}`;
}

export function hasValidWebhookSignatureFormat(
  signatureHeader: string,
): boolean {
  return /^v1=[a-fA-F0-9]{64}$/.test(signatureHeader);
}

export function verifyWebhookSignature({
  secret,
  timestamp,
  nonce,
  rawBody,
  signatureHeader,
}: VerifyWebhookSignatureInput): boolean {
  if (!hasValidWebhookSignatureFormat(signatureHeader)) {
    return false;
  }

  const expectedSignature = createWebhookSignature({
    secret,
    timestamp,
    nonce,
    rawBody,
  }).slice(WEBHOOK_SIGNATURE_PREFIX.length);
  const providedSignature = signatureHeader.slice(WEBHOOK_SIGNATURE_PREFIX.length);

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(providedSignature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
