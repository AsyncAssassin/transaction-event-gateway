import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiOperation,
  ApiRequestTimeoutResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';

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
  @ApiHeader({ name: 'X-Webhook-Timestamp', required: true })
  @ApiHeader({ name: 'X-Webhook-Nonce', required: true })
  @ApiHeader({ name: 'X-Webhook-Signature', required: true })
  @ApiAcceptedResponse({ description: 'Webhook accepted or already accepted.' })
  @ApiBadRequestResponse({
    description: 'Missing headers, invalid JSON, or invalid payload.',
  })
  @ApiUnauthorizedResponse({ description: 'Webhook signature is invalid.' })
  @ApiRequestTimeoutResponse({
    description: 'Webhook timestamp is outside the tolerance window.',
  })
  @ApiConflictResponse({
    description: 'Webhook event ID conflict or nonce replay.',
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
