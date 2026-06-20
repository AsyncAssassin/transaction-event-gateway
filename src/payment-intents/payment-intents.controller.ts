import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentsService } from './payment-intents.service';
import { PaymentIntentResponse } from './payment-intents.types';

@ApiTags('payment-intents')
@Controller('payment-intents')
export class PaymentIntentsController {
  constructor(private readonly paymentIntentsService: PaymentIntentsService) {}

  @Post()
  @ApiOperation({
    operationId: 'createPaymentIntent',
    summary: 'Create a payment intent idempotently',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Idempotency key scoped to payment intent creation.',
  })
  @ApiCreatedResponse({ description: 'Payment intent created.' })
  @ApiOkResponse({
    description: 'Stored idempotent response replayed.',
    headers: {
      'Idempotent-Replayed': {
        description: 'Present with value true when the response is replayed.',
        schema: { type: 'boolean' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Missing header or invalid request body.' })
  @ApiConflictResponse({
    description: 'Idempotency key was already used for a different payload.',
  })
  async createPaymentIntent(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreatePaymentIntentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentIntentResponse> {
    const validatedIdempotencyKey = this.validateIdempotencyKey(idempotencyKey);
    const result = await this.paymentIntentsService.createPaymentIntent(
      validatedIdempotencyKey,
      dto,
    );

    response.status(result.httpStatus);

    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }

    return result.body;
  }

  private validateIdempotencyKey(idempotencyKey: string | undefined): string {
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }

    if (idempotencyKey.length > 255) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header must be 255 characters or fewer.',
      });
    }

    return idempotencyKey;
  }
}
