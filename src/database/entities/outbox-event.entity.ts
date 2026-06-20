import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OutboxEventStatus {
  Pending = 'PENDING',
  Published = 'PUBLISHED',
  Failed = 'FAILED',
}

@Entity('outbox_events')
@Check('outbox_events_attempts_non_negative_chk', '"attempts" >= 0')
@Index('outbox_events_status_next_attempt_idx', ['status', 'nextAttemptAt'])
@Index('outbox_events_aggregate_idx', ['aggregateType', 'aggregateId'])
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'type', type: 'varchar', length: 128 })
  type!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 128 })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({
    name: 'status',
    type: 'enum',
    enum: OutboxEventStatus,
    enumName: 'outbox_event_status',
  })
  status!: OutboxEventStatus;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
