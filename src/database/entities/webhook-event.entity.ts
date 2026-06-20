import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WebhookEventStatus {
  Received = 'RECEIVED',
  Queued = 'QUEUED',
  Processing = 'PROCESSING',
  Processed = 'PROCESSED',
  Failed = 'FAILED',
  Rejected = 'REJECTED',
}

@Entity('webhook_events')
@Index('webhook_events_provider_external_event_id_uniq', [
  'provider',
  'externalEventId',
], {
  unique: true,
})
@Index('webhook_events_provider_nonce_uniq', ['provider', 'nonce'], {
  unique: true,
  where: '"nonce" IS NOT NULL',
})
@Index('webhook_events_payment_intent_id_idx', ['paymentIntentId'])
@Index('webhook_events_status_received_at_idx', ['status', 'receivedAt'])
@Index('webhook_events_tx_hash_idx', ['txHash'])
@Index('webhook_events_payload_hash_idx', ['payloadHash'])
export class WebhookEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'provider', type: 'varchar', length: 128 })
  provider!: string;

  @Column({ name: 'external_event_id', type: 'varchar', length: 255 })
  externalEventId!: string;

  @Column({ name: 'nonce', type: 'varchar', length: 255, nullable: true })
  nonce!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType!: string;

  @Column({ name: 'payment_intent_id', type: 'uuid', nullable: true })
  paymentIntentId!: string | null;

  @Column({ name: 'tx_hash', type: 'varchar', length: 255, nullable: true })
  txHash!: string | null;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'payload_hash', type: 'varchar', length: 128 })
  payloadHash!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: WebhookEventStatus,
    enumName: 'webhook_event_status',
  })
  status!: WebhookEventStatus;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
