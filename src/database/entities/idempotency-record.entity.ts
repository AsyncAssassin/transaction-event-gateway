import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('idempotency_records')
@Index('idempotency_records_scope_key_uniq', ['scope', 'idempotencyKey'], {
  unique: true,
})
@Index('idempotency_records_expires_at_idx', ['expiresAt'])
@Index('idempotency_records_resource_idx', ['resourceType', 'resourceId'])
export class IdempotencyRecordEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'scope', type: 'varchar', length: 128 })
  scope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 128 })
  requestHash!: string;

  @Column({ name: 'response_status', type: 'integer', nullable: true })
  responseStatus!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: Record<string, unknown> | null;

  @Column({ name: 'resource_type', type: 'varchar', length: 128, nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
