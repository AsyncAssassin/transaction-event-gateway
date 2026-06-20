import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { sanitizeErrorMessage } from '../common/errors/sanitize-error';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import {
  OutboxEventEntity,
  OutboxEventStatus,
  WebhookEventEntity,
  WebhookEventStatus,
} from '../database/entities';
import { WebhookEventJobPublisher } from '../processing/webhook-event-job-publisher.service';
import { PROCESS_WEBHOOK_OUTBOX_TYPE } from '../webhooks/webhooks.types';

const DEFAULT_OUTBOX_DISPATCH_BATCH_SIZE = 50;
const OUTBOX_RETRY_BASE_DELAY_MS = 5_000;
const OUTBOX_RETRY_MAX_DELAY_MS = 5 * 60_000;

export type OutboxDispatchBatchResult = {
  selected: number;
  published: number;
  failed: number;
};

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new StructuredLogger(OutboxDispatcherService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobPublisher: WebhookEventJobPublisher,
  ) {}

  async dispatchBatch(
    limit = DEFAULT_OUTBOX_DISPATCH_BATCH_SIZE,
  ): Promise<OutboxDispatchBatchResult> {
    return this.dataSource.transaction(async (manager) => {
      const outboxEvents = await this.findEligibleEvents(manager, limit);
      const result: OutboxDispatchBatchResult = {
        selected: outboxEvents.length,
        published: 0,
        failed: 0,
      };

      for (const outboxEvent of outboxEvents) {
        let webhookEventId: string | undefined;

        try {
          webhookEventId = getWebhookEventId(outboxEvent);
          await this.jobPublisher.publishProcessWebhookEvent(webhookEventId);
          await this.markWebhookQueued(manager, webhookEventId);
          await this.markPublished(manager, outboxEvent.id);
          this.logger.info('outbox_dispatch_published', {
            webhookEventId,
            status: OutboxEventStatus.Published,
          });
          result.published += 1;
        } catch (error) {
          await this.markRetryableFailure(manager, outboxEvent, error);
          this.logger.warn('outbox_dispatch_failed', {
            webhookEventId,
            status: OutboxEventStatus.Failed,
            errorCode: toSafeErrorCode(error, 'OUTBOX_DISPATCH_FAILED'),
          });
          result.failed += 1;
        }
      }

      return result;
    });
  }

  private findEligibleEvents(
    manager: EntityManager,
    limit: number,
  ): Promise<OutboxEventEntity[]> {
    return manager
      .getRepository(OutboxEventEntity)
      .createQueryBuilder('outbox')
      .where('outbox.type = :type', { type: PROCESS_WEBHOOK_OUTBOX_TYPE })
      .andWhere(
        `(
          outbox.status = :pending
          OR (
            outbox.status = :failed
            AND (
              outbox.next_attempt_at IS NULL
              OR outbox.next_attempt_at <= NOW()
            )
          )
        )`,
        {
          pending: OutboxEventStatus.Pending,
          failed: OutboxEventStatus.Failed,
        },
      )
      .orderBy('outbox.created_at', 'ASC')
      .limit(limit)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
  }

  private async markPublished(
    manager: EntityManager,
    outboxEventId: string,
  ): Promise<void> {
    await manager.update(OutboxEventEntity, outboxEventId, {
      status: OutboxEventStatus.Published,
      publishedAt: new Date(),
      nextAttemptAt: null,
      lastError: null,
    });
  }

  private async markWebhookQueued(
    manager: EntityManager,
    webhookEventId: string,
  ): Promise<void> {
    await manager.update(
      WebhookEventEntity,
      {
        id: webhookEventId,
        status: WebhookEventStatus.Received,
      },
      {
        status: WebhookEventStatus.Queued,
      },
    );
  }

  private async markRetryableFailure(
    manager: EntityManager,
    outboxEvent: OutboxEventEntity,
    error: unknown,
  ): Promise<void> {
    const attempts = outboxEvent.attempts + 1;
    const nextAttemptAt = new Date(Date.now() + calculateOutboxBackoffMs(attempts));

    await manager.update(OutboxEventEntity, outboxEvent.id, {
      status: OutboxEventStatus.Failed,
      attempts,
      nextAttemptAt,
      lastError: sanitizeErrorMessage(error),
    });
  }
}

function getWebhookEventId(outboxEvent: OutboxEventEntity): string {
  const payload = outboxEvent.payload as { webhookEventId?: unknown };

  if (typeof payload.webhookEventId !== 'string') {
    throw new Error('INVALID_OUTBOX_PAYLOAD');
  }

  return payload.webhookEventId;
}

function calculateOutboxBackoffMs(attempts: number): number {
  return Math.min(
    OUTBOX_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
    OUTBOX_RETRY_MAX_DELAY_MS,
  );
}
