import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  PaymentIntentEntity,
  PaymentIntentStatus,
  WebhookEventEntity,
  WebhookEventStatus,
  WebhookProcessingAttemptEntity,
  WebhookProcessingAttemptStatus,
} from '../database/entities';

export type ProcessWebhookEventInput = {
  webhookEventId: string;
  jobId?: string | null;
};

type BlockchainWebhookPayload = {
  type?: unknown;
  paymentIntentId?: unknown;
  txHash?: unknown;
  amount?: unknown;
  asset?: unknown;
  reference?: unknown;
};

type ProcessingResult =
  | {
      status: 'processed' | 'already_processed';
    }
  | {
      status: 'failed';
      reason: ProcessingFailureReason;
    };

type ProcessingFailureReason =
  | 'UNKNOWN_PAYMENT_INTENT'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'MISSING_TX_HASH'
  | 'AMOUNT_MISMATCH'
  | 'ASSET_MISMATCH'
  | 'REFERENCE_MISMATCH'
  | 'PAYMENT_INTENT_TERMINAL'
  | 'CONFIRMED_TX_HASH_CONFLICT';

@Injectable()
export class WebhookEventProcessorService {
  constructor(private readonly dataSource: DataSource) {}

  async processWebhookEvent(
    input: ProcessWebhookEventInput,
  ): Promise<ProcessingResult> {
    return this.dataSource.transaction(async (manager) => {
      const startedAt = new Date();
      const webhookEvent = await this.lockWebhookEvent(
        manager,
        input.webhookEventId,
      );

      if (webhookEvent.status === WebhookEventStatus.Processed) {
        await this.insertAttempt(manager, {
          webhookEventId: webhookEvent.id,
          jobId: input.jobId ?? null,
          status: WebhookProcessingAttemptStatus.Succeeded,
          errorMessage: null,
          startedAt,
          finishedAt: new Date(),
        });

        return { status: 'already_processed' };
      }

      webhookEvent.status = WebhookEventStatus.Processing;
      webhookEvent.failureReason = null;
      webhookEvent.processedAt = null;
      await manager.save(webhookEvent);

      const result = await this.applyProcessingRules(
        manager,
        webhookEvent,
        input.jobId ?? null,
        startedAt,
      );

      return result;
    });
  }

  private async lockWebhookEvent(
    manager: EntityManager,
    webhookEventId: string,
  ): Promise<WebhookEventEntity> {
    const webhookEvent = await manager.findOne(WebhookEventEntity, {
      where: { id: webhookEventId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!webhookEvent) {
      throw new Error('WEBHOOK_EVENT_NOT_FOUND');
    }

    return webhookEvent;
  }

  private async applyProcessingRules(
    manager: EntityManager,
    webhookEvent: WebhookEventEntity,
    jobId: string | null,
    startedAt: Date,
  ): Promise<ProcessingResult> {
    const payload = webhookEvent.payload as BlockchainWebhookPayload;

    if (payload.type !== 'transaction.confirmed') {
      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: 'UNSUPPORTED_EVENT_TYPE',
      });
    }

    if (typeof payload.txHash !== 'string' || payload.txHash.trim() === '') {
      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: 'MISSING_TX_HASH',
      });
    }

    const paymentIntent = await this.lockPaymentIntent(manager, webhookEvent);
    if (!paymentIntent) {
      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: 'UNKNOWN_PAYMENT_INTENT',
      });
    }

    const validationFailure = validatePayloadMatchesPaymentIntent(
      payload,
      paymentIntent,
    );
    if (validationFailure) {
      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: validationFailure,
      });
    }

    if (paymentIntent.status === PaymentIntentStatus.Confirmed) {
      if (paymentIntent.confirmedTxHash === payload.txHash) {
        return this.markWebhookProcessed(manager, {
          webhookEvent,
          jobId,
          startedAt,
        });
      }

      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: 'PAYMENT_INTENT_TERMINAL',
      });
    }

    if (
      paymentIntent.status === PaymentIntentStatus.Failed ||
      paymentIntent.status === PaymentIntentStatus.Expired
    ) {
      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: 'PAYMENT_INTENT_TERMINAL',
      });
    }

    const existingConfirmedIntent = await manager.findOne(PaymentIntentEntity, {
      where: { confirmedTxHash: payload.txHash },
      lock: { mode: 'pessimistic_write' },
    });

    if (
      existingConfirmedIntent &&
      existingConfirmedIntent.id !== paymentIntent.id
    ) {
      return this.failWebhookEvent(manager, {
        webhookEvent,
        jobId,
        startedAt,
        reason: 'CONFIRMED_TX_HASH_CONFLICT',
      });
    }

    paymentIntent.status = PaymentIntentStatus.Confirmed;
    paymentIntent.confirmedTxHash = payload.txHash;
    paymentIntent.failureReason = null;

    await manager.save(paymentIntent);

    return this.markWebhookProcessed(manager, {
      webhookEvent,
      jobId,
      startedAt,
    });
  }

  private lockPaymentIntent(
    manager: EntityManager,
    webhookEvent: WebhookEventEntity,
  ): Promise<PaymentIntentEntity | null> {
    if (!webhookEvent.paymentIntentId) {
      return Promise.resolve(null);
    }

    return manager.findOne(PaymentIntentEntity, {
      where: { id: webhookEvent.paymentIntentId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async markWebhookProcessed(
    manager: EntityManager,
    {
      webhookEvent,
      jobId,
      startedAt,
    }: {
      webhookEvent: WebhookEventEntity;
      jobId: string | null;
      startedAt: Date;
    },
  ): Promise<ProcessingResult> {
    webhookEvent.status = WebhookEventStatus.Processed;
    webhookEvent.failureReason = null;
    webhookEvent.processedAt = new Date();
    await manager.save(webhookEvent);

    await this.insertAttempt(manager, {
      webhookEventId: webhookEvent.id,
      jobId,
      status: WebhookProcessingAttemptStatus.Succeeded,
      errorMessage: null,
      startedAt,
      finishedAt: new Date(),
    });

    return { status: 'processed' };
  }

  private async failWebhookEvent(
    manager: EntityManager,
    {
      webhookEvent,
      jobId,
      startedAt,
      reason,
    }: {
      webhookEvent: WebhookEventEntity;
      jobId: string | null;
      startedAt: Date;
      reason: ProcessingFailureReason;
    },
  ): Promise<ProcessingResult> {
    webhookEvent.status = WebhookEventStatus.Failed;
    webhookEvent.failureReason = reason;
    webhookEvent.processedAt = new Date();
    await manager.save(webhookEvent);

    await this.insertAttempt(manager, {
      webhookEventId: webhookEvent.id,
      jobId,
      status: WebhookProcessingAttemptStatus.Failed,
      errorMessage: reason,
      startedAt,
      finishedAt: new Date(),
    });

    return {
      status: 'failed',
      reason,
    };
  }

  private async insertAttempt(
    manager: EntityManager,
    attempt: {
      webhookEventId: string;
      jobId: string | null;
      status: WebhookProcessingAttemptStatus;
      errorMessage: string | null;
      startedAt: Date;
      finishedAt: Date;
    },
  ): Promise<void> {
    await manager.insert(WebhookProcessingAttemptEntity, attempt);
  }
}

function validatePayloadMatchesPaymentIntent(
  payload: BlockchainWebhookPayload,
  paymentIntent: PaymentIntentEntity,
): ProcessingFailureReason | null {
  if (
    typeof payload.amount !== 'string' ||
    normalizeAmount(payload.amount) !== normalizeAmount(paymentIntent.amount)
  ) {
    return 'AMOUNT_MISMATCH';
  }

  if (payload.asset !== paymentIntent.asset) {
    return 'ASSET_MISMATCH';
  }

  if (
    typeof payload.reference === 'string' &&
    paymentIntent.reference !== payload.reference
  ) {
    return 'REFERENCE_MISMATCH';
  }

  return null;
}

function normalizeAmount(amount: string): string {
  const [integerPart, fractionalPart = ''] = amount.split('.');
  const normalizedInteger = BigInt(integerPart).toString();
  const normalizedFraction = `${fractionalPart}${'0'.repeat(18)}`.slice(0, 18);

  return `${normalizedInteger}.${normalizedFraction}`;
}
