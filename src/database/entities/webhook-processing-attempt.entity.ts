import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WebhookEventEntity } from './webhook-event.entity';

export enum WebhookProcessingAttemptStatus {
  Started = 'STARTED',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
}

@Entity('webhook_processing_attempts')
@Check(
  'webhook_processing_attempts_status_chk',
  `"status" IN ('STARTED', 'SUCCEEDED', 'FAILED')`,
)
@Check(
  'webhook_processing_attempts_finished_after_started_chk',
  '"finished_at" IS NULL OR "finished_at" >= "started_at"',
)
@Index('webhook_processing_attempts_event_idx', ['webhookEventId'])
@Index('webhook_processing_attempts_status_idx', ['status'])
export class WebhookProcessingAttemptEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'webhook_event_id', type: 'uuid' })
  webhookEventId!: string;

  @ManyToOne(() => WebhookEventEntity, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'webhook_event_id',
    foreignKeyConstraintName: 'webhook_processing_attempts_event_fk',
  })
  webhookEvent!: WebhookEventEntity;

  @Column({ name: 'job_id', type: 'varchar', length: 255, nullable: true })
  jobId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 64 })
  status!: WebhookProcessingAttemptStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
