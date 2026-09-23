import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import {
  ApiErrorResponses,
  DATABASE_UNAVAILABLE_DESCRIPTION,
  RATE_LIMITED_DESCRIPTION,
  REQUEST_BODY_TOO_LARGE_DESCRIPTION,
  UNSUPPORTED_MEDIA_TYPE_DESCRIPTION,
} from '../common/openapi/api-error-responses.decorator';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentResponseDto } from './dto/payment-intent-response.dto';
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
    description:
      'Idempotency key scoped to payment intent creation, at most 255 characters.',
  })
  @ApiCreatedResponse({
    description: 'Payment intent created.',
    type: PaymentIntentResponseDto,
  })
  @ApiOkResponse({
    description:
      'The response stored for the first request with this key and payload, replayed.',
    type: PaymentIntentResponseDto,
    headers: {
      'Idempotent-Replayed': {
        description: 'Present with value true when the response is replayed.',
        schema: { type: 'boolean' },
      },
    },
  })
  @ApiErrorResponses({
    [HttpStatus.BAD_REQUEST]:
      'Missing or oversized Idempotency-Key, malformed JSON, or an invalid body (VALIDATION_ERROR).',
    [HttpStatus.CONFLICT]:
      'The Idempotency-Key was already used with a different payload (IDEMPOTENCY_CONFLICT).',
    [HttpStatus.PAYLOAD_TOO_LARGE]: REQUEST_BODY_TOO_LARGE_DESCRIPTION,
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: UNSUPPORTED_MEDIA_TYPE_DESCRIPTION,
    [HttpStatus.TOO_MANY_REQUESTS]: RATE_LIMITED_DESCRIPTION,
    [HttpStatus.SERVICE_UNAVAILABLE]: DATABASE_UNAVAILABLE_DESCRIPTION,
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

  @Get(':id')
  @ApiOperation({
    operationId: 'getPaymentIntent',
    summary: 'Get the current state of a payment intent',
  })
  @ApiParam({ name: 'id', description: 'Payment intent ID.', format: 'uuid' })
  @ApiOkResponse({
    description: 'Payment intent found.',
    type: PaymentIntentResponseDto,
  })
  @ApiErrorResponses({
    [HttpStatus.BAD_REQUEST]: 'The ID is not a UUID (VALIDATION_ERROR).',
    [HttpStatus.NOT_FOUND]: 'No payment intent has this ID (NOT_FOUND).',
    [HttpStatus.TOO_MANY_REQUESTS]: RATE_LIMITED_DESCRIPTION,
    [HttpStatus.SERVICE_UNAVAILABLE]: DATABASE_UNAVAILABLE_DESCRIPTION,
  })
  getPaymentIntent(
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException({
            error: 'VALIDATION_ERROR',
            message: 'Request validation failed.',
            details: [{ field: 'id', message: 'id must be a UUID' }],
          }),
      }),
    )
    id: string,
  ): Promise<PaymentIntentResponse> {
    return this.paymentIntentsService.getPaymentIntent(id);
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
