import { JsonValue } from '../common/canonicalization/canonical-json';

export const BLOCKCHAIN_WEBHOOK_PROVIDER = 'blockchain';
export const PROCESS_WEBHOOK_OUTBOX_TYPE = 'process-webhook-event';
export const WEBHOOK_OUTBOX_AGGREGATE_TYPE = 'webhook_event';

// correlationId is the X-Correlation-ID of the request that accepted the
// webhook. Rows written before it was added have only webhookEventId.
export type ProcessWebhookOutboxPayload = {
  webhookEventId: string;
  correlationId?: string;
};

export type BlockchainWebhookPayload = {
  eventId: string;
  type: string;
  paymentIntentId: string;
  txHash: string | null;
  amount: string;
  asset: string;
};

export type BlockchainWebhookJsonPayload = BlockchainWebhookPayload & {
  [key: string]: JsonValue;
};

export type WebhookAcceptanceStatus = 'ACCEPTED' | 'ALREADY_ACCEPTED';

export type WebhookAcceptanceResponse = {
  eventId: string;
  status: WebhookAcceptanceStatus;
};

export type WebhookRequestHeaders = {
  contentType: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
};

export type AcceptBlockchainWebhookRequest = {
  headers: WebhookRequestHeaders;
  rawBody: Buffer;
  body: unknown;
};
