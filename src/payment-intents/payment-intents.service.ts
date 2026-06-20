import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { hashCanonicalJson, JsonValue } from '../common/canonicalization/canonical-json';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import {
  IdempotencyRecordEntity,
  PaymentIntentEntity,
  PaymentIntentStatus,
} from '../database/entities';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import {
  CreatePaymentIntentResult,
  PaymentIntentResponse,
} from './payment-intents.types';

const IDEMPOTENCY_SCOPE = 'payment-intents:create';
const IDEMPOTENCY_RESOURCE_TYPE = 'payment_intent';

type PaymentIntentCreatePayload = {
  amount: string;
  asset: string;
  destination: string;
  reference: string | null;
  clientRequestId: string | null;
  metadata: JsonValue;
};

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new StructuredLogger(PaymentIntentsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async createPaymentIntent(
    idempotencyKey: string,
    dto: CreatePaymentIntentDto,
  ): Promise<CreatePaymentIntentResult> {
    const canonicalPayload = this.toCanonicalPayload(dto);
    const requestHash = hashCanonicalJson(canonicalPayload);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const idempotencyRecordId = await this.tryInsertIdempotencyRecord(
          manager,
          idempotencyKey,
          requestHash,
        );

        if (idempotencyRecordId === null) {
          return this.replayOrRejectConflict(
            manager,
            idempotencyKey,
            requestHash,
          );
        }

        const paymentIntent = await manager.save(
          manager.create(PaymentIntentEntity, {
            status: PaymentIntentStatus.Created,
            amount: dto.amount,
            asset: dto.asset,
            destination: dto.destination,
            reference: dto.reference ?? null,
            clientRequestId: dto.clientRequestId ?? null,
            metadata: dto.metadata ?? {},
            confirmedTxHash: null,
            failureReason: null,
            expiresAt: null,
          }),
        );

        const responseBody = this.toResponse(paymentIntent);

        const idempotencyRecord = await manager.findOneByOrFail(
          IdempotencyRecordEntity,
          { id: idempotencyRecordId },
        );
        idempotencyRecord.responseStatus = 201;
        idempotencyRecord.responseBody =
          responseBody as unknown as Record<string, unknown>;
        idempotencyRecord.resourceType = IDEMPOTENCY_RESOURCE_TYPE;
        idempotencyRecord.resourceId = paymentIntent.id;
        await manager.save(idempotencyRecord);

        return {
          httpStatus: 201 as const,
          replayed: false as const,
          body: responseBody,
        };
      });

      this.logger.info(
        result.replayed ? 'payment_intent_replayed' : 'payment_intent_created',
        {
          paymentIntentId: result.body.id,
          status: result.body.status,
        },
      );

      return result;
    } catch (error) {
      const errorCode = toSafeErrorCode(
        error,
        'PAYMENT_INTENT_CREATE_FAILED',
      );

      if (errorCode === 'IDEMPOTENCY_CONFLICT') {
        this.logger.warn('payment_intent_conflict', {
          status: 'CONFLICT',
          errorCode,
        });
      }

      throw error;
    }
  }

  private async tryInsertIdempotencyRecord(
    manager: EntityManager,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<string | null> {
    const insertResult = await manager
      .createQueryBuilder()
      .insert()
      .into(IdempotencyRecordEntity)
      .values({
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    const insertedRows = insertResult.raw as Array<{ id: string }>;
    return insertedRows[0]?.id ?? null;
  }

  private async replayOrRejectConflict(
    manager: EntityManager,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CreatePaymentIntentResult> {
    const existingRecord = await manager.findOne(IdempotencyRecordEntity, {
      where: {
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey,
      },
    });

    if (!existingRecord) {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'The idempotency record could not be read after conflict detection.',
      });
    }

    if (existingRecord.requestHash !== requestHash) {
      throw new ConflictException({
        error: 'IDEMPOTENCY_CONFLICT',
        message:
          'The provided Idempotency-Key was already used with a different request payload.',
      });
    }

    if (existingRecord.responseStatus === null || existingRecord.responseBody === null) {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'The idempotent response snapshot is not available.',
      });
    }

    return {
      httpStatus: 200,
      replayed: true,
      body: existingRecord.responseBody as unknown as PaymentIntentResponse,
    };
  }

  private toCanonicalPayload(dto: CreatePaymentIntentDto): PaymentIntentCreatePayload {
    return {
      amount: dto.amount,
      asset: dto.asset,
      destination: dto.destination,
      reference: dto.reference ?? null,
      clientRequestId: dto.clientRequestId ?? null,
      metadata: (dto.metadata ?? {}) as JsonValue,
    };
  }

  private toResponse(paymentIntent: PaymentIntentEntity): PaymentIntentResponse {
    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      asset: paymentIntent.asset,
      destination: paymentIntent.destination,
      reference: paymentIntent.reference,
      clientRequestId: paymentIntent.clientRequestId,
      createdAt: paymentIntent.createdAt.toISOString(),
    };
  }
}
