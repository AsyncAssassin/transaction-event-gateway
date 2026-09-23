import { WebhookEventJobPublisher } from './webhook-event-job-publisher.service';
import { WebhookEventsQueueHolder } from './webhook-events-queue-holder.service';

describe('WebhookEventJobPublisher', () => {
  it('delegates process-webhook-event publishing to the queue holder', async () => {
    const queueHolder = {
      addProcessWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };
    const publisher = new WebhookEventJobPublisher(
      queueHolder as unknown as WebhookEventsQueueHolder,
    );

    await publisher.publishProcessWebhookEvent({
      webhookEventId: 'webhook-event-1',
      correlationId: 'request-123',
    });

    expect(queueHolder.addProcessWebhookEvent).toHaveBeenCalledWith({
      webhookEventId: 'webhook-event-1',
      correlationId: 'request-123',
    });
  });
});
