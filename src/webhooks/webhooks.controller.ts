import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import {
  ApiErrorResponses,
  DATABASE_UNAVAILABLE_DESCRIPTION,
  RATE_LIMITED_DESCRIPTION,
  REQUEST_BODY_TOO_LARGE_DESCRIPTION,
  UNSUPPORTED_MEDIA_TYPE_DESCRIPTION,
} from '../common/openapi/api-error-responses.decorator';
import { BlockchainWebhookDto } from './dto/blockchain-webhook.dto';
import { WebhookAcceptanceResponseDto } from './dto/webhook-acceptance-response.dto';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookAcceptanceResponse } from './webhooks.types';

type RequestWithRawBody = Request & {
  rawBody?: Buffer;
};

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhookEventsService: WebhookEventsService) {}

  @Post('blockchain')
  @HttpCode(202)
  @ApiOperation({
    operationId: 'acceptBlockchainWebhook',
    summary: 'Accept a signed blockchain webhook event',
  })
  @ApiHeader({
    name: 'X-Webhook-Timestamp',
    required: true,
    description:
      'Unix time in seconds, within WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS (default 300) of the server clock.',
  })
  @ApiHeader({
    name: 'X-Webhook-Nonce',
    required: true,
    description: 'Unique per provider event, at most 255 characters.',
  })
  @ApiHeader({
    name: 'X-Webhook-Signature',
    required: true,
    description:
      'v1=<hex HMAC-SHA256 of timestamp + "." + nonce + "." + raw request body>, keyed with WEBHOOK_SECRET.',
  })
  @ApiBody({
    type: BlockchainWebhookDto,
    description:
      'Validated after the signature check. The signature covers the exact request bytes, so send the body as signed.',
  })
  @ApiAcceptedResponse({
    description: 'Webhook accepted, or already accepted with the same payload.',
    type: WebhookAcceptanceResponseDto,
  })
  @ApiErrorResponses({
    [HttpStatus.BAD_REQUEST]:
      'Missing headers, malformed JSON, or an invalid payload (VALIDATION_ERROR), or a timestamp outside the tolerance window (STALE_WEBHOOK_TIMESTAMP).',
    [HttpStatus.UNAUTHORIZED]:
      'The signature does not match (INVALID_WEBHOOK_SIGNATURE).',
    [HttpStatus.CONFLICT]:
      'The event ID was already used with a different payload (WEBHOOK_EVENT_CONFLICT), or the nonce with a different event (WEBHOOK_NONCE_REPLAY).',
    [HttpStatus.PAYLOAD_TOO_LARGE]: REQUEST_BODY_TOO_LARGE_DESCRIPTION,
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: UNSUPPORTED_MEDIA_TYPE_DESCRIPTION,
    [HttpStatus.TOO_MANY_REQUESTS]: RATE_LIMITED_DESCRIPTION,
    [HttpStatus.SERVICE_UNAVAILABLE]: DATABASE_UNAVAILABLE_DESCRIPTION,
  })
  async acceptBlockchainWebhook(
    @Req() request: RequestWithRawBody,
  ): Promise<WebhookAcceptanceResponse> {
    if (!Buffer.isBuffer(request.rawBody)) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Raw request body is required for webhook verification.',
      });
    }

    return this.webhookEventsService.acceptBlockchainWebhook({
      headers: {
        contentType: request.header('content-type'),
        timestamp: request.header('x-webhook-timestamp'),
        nonce: request.header('x-webhook-nonce'),
        signature: request.header('x-webhook-signature'),
      },
      rawBody: request.rawBody,
      body: request.body,
    });
  }
}
