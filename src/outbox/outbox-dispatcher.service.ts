import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { describeError } from '../common/errors/describe-error';
import { sanitizeErrorMessage } from '../common/errors/sanitize-error';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import {
  normalizeCorrelationId,
  runWithCorrelationId,
} from '../common/request-context/request-context';
import {
  OutboxEventEntity,
  OutboxEventStatus,
  WebhookEventEntity,
  WebhookEventStatus,
} from '../database/entities';
import { ProcessWebhookEventJobData } from '../processing/queue.constants';
import { WebhookEventJobPublisher } from '../processing/webhook-event-job-publisher.service';
import {
  PROCESS_WEBHOOK_OUTBOX_TYPE,
  WEBHOOK_OUTBOX_AGGREGATE_TYPE,
} from '../webhooks/webhooks.types';

const DEFAULT_OUTBOX_DISPATCH_BATCH_SIZE = 50;
const OUTBOX_RETRY_BASE_DELAY_MS = 5_000;
const OUTBOX_RETRY_MAX_DELAY_MS = 5 * 60_000;
const INVALID_OUTBOX_PAYLOAD = 'INVALID_OUTBOX_PAYLOAD';

// Well above the ~75 s a job needs to exhaust its BullMQ attempts, so a job
// that is still retrying is not republished.
export const DEFAULT_STALE_PUBLISHED_AFTER_MS = 10 * 60_000;
const DEFAULT_OUTBOX_RECONCILE_BATCH_SIZE = 100;
const STALE_PUBLISHED_WEBHOOK_REQUEUED = 'STALE_PUBLISHED_WEBHOOK_REQUEUED';

export type OutboxDispatchBatchResult = {
  selected: number;
  published: number;
  failed: number;
};

export type OutboxReconcileResult = {
  requeued: number;
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
        let jobData: ProcessWebhookEventJobData;

        try {
          jobData = toJobData(outboxEvent);
        } catch (error) {
          if (error instanceof NonRetryableOutboxError) {
            await this.markNonRetryableFailure(manager, outboxEvent, error);
            this.logger.warn('outbox_dispatch_poisoned', {
              webhookEventId: outboxEvent.aggregateId,
              status: OutboxEventStatus.Failed,
              errorCode: toSafeErrorCode(error, INVALID_OUTBOX_PAYLOAD),
            });
          } else {
            await this.markTransientFailure(manager, outboxEvent, error);
            this.logger.warn('outbox_dispatch_failed', {
              status: OutboxEventStatus.Failed,
              errorCode: toSafeErrorCode(error, 'OUTBOX_DISPATCH_FAILED'),
              ...describeError(error),
            });
          }
          result.failed += 1;
          continue;
        }

        const published = await runWithCorrelationId(
          jobData.correlationId,
          () => this.publishOutboxEvent(manager, outboxEvent, jobData),
        );

        if (published) {
          result.published += 1;
          continue;
        }

        result.failed += 1;
        // A failed publish means Redis is down or not answering, so the
        // remaining rows would fail the same way, each after a command
        // timeout, while this transaction keeps them locked. Leave them for
        // the next run.
        break;
      }

      return result;
    });
  }

  // Runs under the correlation ID of the webhook request, so these log lines,
  // and those of the queue holder, carry it.
  private async publishOutboxEvent(
    manager: EntityManager,
    outboxEvent: OutboxEventEntity,
    jobData: ProcessWebhookEventJobData,
  ): Promise<boolean> {
    const { webhookEventId } = jobData;

    try {
      await this.jobPublisher.publishProcessWebhookEvent(jobData);
      await this.markWebhookQueued(manager, webhookEventId);
      await this.markPublished(manager, outboxEvent.id);
      this.logger.info('outbox_dispatch_published', {
        webhookEventId,
        status: OutboxEventStatus.Published,
      });
      return true;
    } catch (error) {
      await this.markTransientFailure(manager, outboxEvent, error);
      this.logger.warn('outbox_dispatch_failed', {
        webhookEventId,
        status: OutboxEventStatus.Failed,
        errorCode: toSafeErrorCode(error, 'OUTBOX_DISPATCH_FAILED'),
        ...describeError(error),
      });
      return false;
    }
  }

  // After a successful publish the BullMQ job is the only record of pending
  // work. If Redis loses the job, or the job exhausts its attempts (for example
  // during a PostgreSQL outage), the webhook event stays QUEUED behind a
  // PUBLISHED outbox row that the dispatcher never selects again. Hand such
  // rows back to the dispatcher; a duplicate job is harmless because the worker
  // locks the webhook event and skips it once it is PROCESSED. SKIP LOCKED
  // makes concurrent runs from several worker processes safe and also skips
  // webhook events a worker is processing right now.
  async reconcileStalePublishedEvents(
    olderThanMs = DEFAULT_STALE_PUBLISHED_AFTER_MS,
    limit = DEFAULT_OUTBOX_RECONCILE_BATCH_SIZE,
  ): Promise<OutboxReconcileResult> {
    const [rows] = (await this.dataSource.query(
      `
        WITH stale AS (
          SELECT outbox.id
          FROM webhook_events webhook
          JOIN outbox_events outbox
            ON outbox.aggregate_type = $1
            AND outbox.aggregate_id = webhook.id
          WHERE webhook.status IN ($2, $3)
            AND outbox.type = $4
            AND outbox.status = $5
            AND outbox.dead_at IS NULL
            AND outbox.published_at < now() - $6::double precision * interval '1 millisecond'
          ORDER BY outbox.published_at
          LIMIT $7
          FOR UPDATE OF outbox, webhook SKIP LOCKED
        )
        UPDATE outbox_events outbox
        SET
          status = $8,
          next_attempt_at = now(),
          last_error = $9,
          updated_at = now()
        FROM stale
        WHERE outbox.id = stale.id
        RETURNING
          outbox.aggregate_id AS "webhookEventId",
          outbox.payload ->> 'correlationId' AS "correlationId"
      `,
      [
        WEBHOOK_OUTBOX_AGGREGATE_TYPE,
        WebhookEventStatus.Received,
        WebhookEventStatus.Queued,
        PROCESS_WEBHOOK_OUTBOX_TYPE,
        OutboxEventStatus.Published,
        olderThanMs,
        limit,
        OutboxEventStatus.Failed,
        STALE_PUBLISHED_WEBHOOK_REQUEUED,
      ],
    )) as [
      Array<{ webhookEventId: string; correlationId: string | null }>,
      number,
    ];

    for (const row of rows) {
      this.logger.warn('outbox_reconcile_requeued', {
        webhookEventId: row.webhookEventId,
        correlationId: normalizeCorrelationId(row.correlationId ?? undefined),
        status: OutboxEventStatus.Failed,
        errorCode: STALE_PUBLISHED_WEBHOOK_REQUEUED,
      });
    }

    return { requeued: rows.length };
  }

  private findEligibleEvents(
    manager: EntityManager,
    limit: number,
  ): Promise<OutboxEventEntity[]> {
    return manager
      .getRepository(OutboxEventEntity)
      .createQueryBuilder('outbox')
      .where('outbox.type = :type', { type: PROCESS_WEBHOOK_OUTBOX_TYPE })
      .andWhere('outbox.dead_at IS NULL')
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

  private async markTransientFailure(
    manager: EntityManager,
    outboxEvent: OutboxEventEntity,
    error: unknown,
  ): Promise<void> {
    const attempts = outboxEvent.attempts + 1;

    await manager.update(OutboxEventEntity, outboxEvent.id, {
      status: OutboxEventStatus.Failed,
      attempts,
      nextAttemptAt: new Date(Date.now() + calculateOutboxBackoffMs(attempts)),
      deadAt: null,
      lastError: sanitizeErrorMessage(error),
    });
  }

  private async markNonRetryableFailure(
    manager: EntityManager,
    outboxEvent: OutboxEventEntity,
    error: unknown,
  ): Promise<void> {
    const attempts = outboxEvent.attempts + 1;

    await manager.update(OutboxEventEntity, outboxEvent.id, {
      status: OutboxEventStatus.Failed,
      attempts,
      nextAttemptAt: null,
      deadAt: new Date(),
      lastError: sanitizeErrorMessage(error),
    });
  }
}

class NonRetryableOutboxError extends Error {
  constructor(readonly code: typeof INVALID_OUTBOX_PAYLOAD) {
    super(code);
    this.name = 'NonRetryableOutboxError';
  }
}

function toJobData(outboxEvent: OutboxEventEntity): ProcessWebhookEventJobData {
  const payload = outboxEvent.payload as {
    webhookEventId?: unknown;
    correlationId?: unknown;
  };

  if (typeof payload.webhookEventId !== 'string') {
    throw new NonRetryableOutboxError(INVALID_OUTBOX_PAYLOAD);
  }

  // A missing or malformed correlation ID only costs log correlation, so the
  // job is still published, without it.
  const correlationId =
    typeof payload.correlationId === 'string'
      ? normalizeCorrelationId(payload.correlationId)
      : undefined;

  return correlationId === undefined
    ? { webhookEventId: payload.webhookEventId }
    : { webhookEventId: payload.webhookEventId, correlationId };
}

function calculateOutboxBackoffMs(attempts: number): number {
  return Math.min(
    OUTBOX_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
    OUTBOX_RETRY_MAX_DELAY_MS,
  );
}
