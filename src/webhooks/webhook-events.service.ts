import {
  BadRequestException,
  ConflictException,
  Injectable,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import {
  hashCanonicalJson,
  JsonValue,
} from '../common/canonicalization/canonical-json';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import { createValidationException } from '../common/validation/validation-error-response';
import {
  OutboxEventEntity,
  OutboxEventStatus,
  WebhookEventEntity,
  WebhookEventStatus,
} from '../database/entities';
import { BlockchainWebhookDto } from './dto/blockchain-webhook.dto';
import {
  hasValidWebhookSignatureFormat,
  verifyWebhookSignature,
} from './security/webhook-signature';
import { validateWebhookTimestamp } from './security/webhook-timestamp';
import {
  AcceptBlockchainWebhookRequest,
  BLOCKCHAIN_WEBHOOK_PROVIDER,
  BlockchainWebhookJsonPayload,
  BlockchainWebhookPayload,
  PROCESS_WEBHOOK_OUTBOX_TYPE,
  WebhookAcceptanceResponse,
  WebhookRequestHeaders,
  WEBHOOK_OUTBOX_AGGREGATE_TYPE,
} from './webhooks.types';

type ValidatedWebhookHeaders = {
  timestamp: string;
  nonce: string;
  signature: string;
};

@Injectable()
export class WebhookEventsService {
  private readonly logger = new StructuredLogger(WebhookEventsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async acceptBlockchainWebhook(
    request: AcceptBlockchainWebhookRequest,
  ): Promise<WebhookAcceptanceResponse> {
    const externalEventId = extractExternalEventId(request.body);

    try {
      const headers = this.validateHeaders(request.headers);
      this.validateTimestamp(headers.timestamp);
      this.verifySignature(headers, request.rawBody);

      const dto = await this.validatePayload(request.body);
      const payload = this.toPayload(dto);
      const payloadHash = hashCanonicalJson(payload as JsonValue);

      const response = await this.dataSource.transaction(async (manager) => {
        const webhookEventId = await this.tryInsertWebhookEvent(
          manager,
          headers.nonce,
          payload,
          payloadHash,
        );

        if (webhookEventId === null) {
          return this.replayOrRejectConflict(
            manager,
            headers.nonce,
            payload.eventId,
            payloadHash,
          );
        }

        await this.insertOutboxEvent(manager, webhookEventId);

        return {
          eventId: payload.eventId,
          status: 'ACCEPTED' as const,
        };
      });

      this.logger.info(
        response.status === 'ACCEPTED' ? 'webhook_accepted' : 'webhook_replayed',
        {
          provider: BLOCKCHAIN_WEBHOOK_PROVIDER,
          externalEventId: response.eventId,
          status: response.status,
        },
      );

      return response;
    } catch (error) {
      this.logger.warn('webhook_rejected', {
        provider: BLOCKCHAIN_WEBHOOK_PROVIDER,
        externalEventId,
        status: 'REJECTED',
        errorCode: toSafeErrorCode(error, 'WEBHOOK_REJECTED'),
      });

      throw error;
    }
  }

  private validateHeaders(headers: WebhookRequestHeaders): ValidatedWebhookHeaders {
    const contentType = headers.contentType?.toLowerCase().split(';')[0]?.trim();

    if (
      !contentType ||
      contentType !== 'application/json'
    ) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Content-Type must be application/json.',
      });
    }

    if (!headers.timestamp || headers.timestamp.trim() === '') {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'X-Webhook-Timestamp header is required.',
      });
    }

    if (!headers.nonce || headers.nonce.trim() === '') {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'X-Webhook-Nonce header is required.',
      });
    }

    if (headers.nonce.length > 255) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'X-Webhook-Nonce header must be 255 characters or fewer.',
      });
    }

    if (!headers.signature || headers.signature.trim() === '') {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'X-Webhook-Signature header is required.',
      });
    }

    return {
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      signature: headers.signature,
    };
  }

  private validateTimestamp(timestamp: string): void {
    const toleranceSeconds = Number(
      this.configService.get('WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS') ?? 300,
    );
    const result = validateWebhookTimestamp(timestamp, toleranceSeconds);

    if (result.ok) {
      return;
    }

    if (result.reason === 'INVALID_FORMAT') {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'X-Webhook-Timestamp header must be a Unix timestamp.',
      });
    }

    throw new RequestTimeoutException({
      error: 'STALE_WEBHOOK_TIMESTAMP',
      message: 'Webhook timestamp is outside the configured tolerance window.',
    });
  }

  private verifySignature(
    headers: ValidatedWebhookHeaders,
    rawBody: Buffer,
  ): void {
    if (!hasValidWebhookSignatureFormat(headers.signature)) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'X-Webhook-Signature header must use v1=<hex_signature> format.',
      });
    }

    const secret = this.configService.get<string>('WEBHOOK_SECRET');

    if (!secret) {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Webhook verification is not configured.',
      });
    }

    const validSignature = verifyWebhookSignature({
      secret,
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      rawBody,
      signatureHeader: headers.signature,
    });

    if (!validSignature) {
      throw new UnauthorizedException({
        error: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Webhook signature verification failed.',
      });
    }
  }

  private async validatePayload(body: unknown): Promise<BlockchainWebhookDto> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Request body must be a JSON object.',
      });
    }

    const dto = plainToInstance(BlockchainWebhookDto, body);
    const errors = await validate(dto, {
      forbidNonWhitelisted: true,
      whitelist: true,
    });

    if (errors.length > 0) {
      throw createValidationException(errors);
    }

    return dto;
  }

  private async tryInsertWebhookEvent(
    manager: EntityManager,
    nonce: string,
    payload: BlockchainWebhookJsonPayload,
    payloadHash: string,
  ): Promise<string | null> {
    const webhookValues: QueryDeepPartialEntity<WebhookEventEntity> = {
      provider: BLOCKCHAIN_WEBHOOK_PROVIDER,
      externalEventId: payload.eventId,
      nonce,
      eventType: payload.type,
      paymentIntentId: payload.paymentIntentId,
      txHash: payload.txHash,
      payload: payload as QueryDeepPartialEntity<Record<string, unknown>>,
      payloadHash,
      status: WebhookEventStatus.Received,
      failureReason: null,
      receivedAt: new Date(),
      processedAt: null,
    };

    const insertResult = await manager
      .createQueryBuilder()
      .insert()
      .into(WebhookEventEntity)
      .values(webhookValues)
      .orIgnore()
      .returning(['id'])
      .execute();

    const insertedRows = insertResult.raw as Array<{ id: string }>;
    return insertedRows[0]?.id ?? null;
  }

  private async replayOrRejectConflict(
    manager: EntityManager,
    nonce: string,
    eventId: string,
    payloadHash: string,
  ): Promise<WebhookAcceptanceResponse> {
    const existingEvent = await manager.findOne(WebhookEventEntity, {
      where: {
        provider: BLOCKCHAIN_WEBHOOK_PROVIDER,
        externalEventId: eventId,
      },
    });

    if (existingEvent) {
      if (existingEvent.payloadHash === payloadHash) {
        return {
          eventId,
          status: 'ALREADY_ACCEPTED',
        };
      }

      throw new ConflictException({
        error: 'WEBHOOK_EVENT_CONFLICT',
        message:
          'The provider event ID was already used with a different payload.',
      });
    }

    const existingNonce = await manager.findOne(WebhookEventEntity, {
      where: {
        provider: BLOCKCHAIN_WEBHOOK_PROVIDER,
        nonce,
      },
    });

    if (existingNonce) {
      throw new ConflictException({
        error: 'WEBHOOK_NONCE_REPLAY',
        message: 'The webhook nonce was already used for a different event.',
      });
    }

    throw new ServiceUnavailableException({
      error: 'SERVICE_UNAVAILABLE',
      message: 'The webhook conflict could not be classified after insert.',
    });
  }

  private async insertOutboxEvent(
    manager: EntityManager,
    webhookEventId: string,
  ): Promise<void> {
    await manager.insert(OutboxEventEntity, {
      type: PROCESS_WEBHOOK_OUTBOX_TYPE,
      aggregateType: WEBHOOK_OUTBOX_AGGREGATE_TYPE,
      aggregateId: webhookEventId,
      payload: {
        webhookEventId,
      },
      status: OutboxEventStatus.Pending,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      publishedAt: null,
    });
  }

  private toPayload(dto: BlockchainWebhookDto): BlockchainWebhookJsonPayload {
    const payload: BlockchainWebhookPayload = {
      eventId: dto.eventId,
      type: dto.type,
      paymentIntentId: dto.paymentIntentId,
      txHash: dto.txHash ?? null,
      amount: dto.amount,
      asset: dto.asset,
    };

    return payload as BlockchainWebhookJsonPayload;
  }
}

function extractExternalEventId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }

  const eventId = (body as { eventId?: unknown }).eventId;

  return typeof eventId === 'string' ? eventId : undefined;
}
