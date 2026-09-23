import { ApiProperty } from '@nestjs/swagger';

import {
  WebhookAcceptanceResponse,
  WebhookAcceptanceStatus,
} from '../webhooks.types';

export class WebhookAcceptanceResponseDto implements WebhookAcceptanceResponse {
  @ApiProperty({
    description: 'Provider event ID from the body.',
    example: 'evt_123',
  })
  eventId!: string;

  @ApiProperty({
    enum: ['ACCEPTED', 'ALREADY_ACCEPTED'],
    description:
      'ACCEPTED for a new event; ALREADY_ACCEPTED for a repeat with the same event ID and payload.',
    example: 'ACCEPTED',
  })
  status!: WebhookAcceptanceStatus;
}
