import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PaymentIntentStatus {
  Created = 'CREATED',
  Processing = 'PROCESSING',
  Confirmed = 'CONFIRMED',
  Failed = 'FAILED',
  Expired = 'EXPIRED',
}

@Entity('payment_intents')
@Check('payment_intents_amount_positive_chk', '"amount" > 0')
@Index('payment_intents_status_idx', ['status'])
@Index('payment_intents_created_at_idx', ['createdAt'])
@Index('payment_intents_client_request_id_idx', ['clientRequestId'])
@Index('payment_intents_reference_idx', ['reference'])
@Index('payment_intents_confirmed_tx_hash_uniq', ['confirmedTxHash'], {
  unique: true,
  where: '"confirmed_tx_hash" IS NOT NULL',
})
export class PaymentIntentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: PaymentIntentStatus,
    enumName: 'payment_intent_status',
  })
  status!: PaymentIntentStatus;

  @Column({ name: 'amount', type: 'numeric', precision: 36, scale: 18 })
  amount!: string;

  @Column({ name: 'asset', type: 'varchar', length: 32 })
  asset!: string;

  @Column({ name: 'destination', type: 'varchar', length: 255 })
  destination!: string;

  @Column({ name: 'reference', type: 'varchar', length: 255, nullable: true })
  reference!: string | null;

  @Column({
    name: 'client_request_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  clientRequestId!: string | null;

  @Column({
    name: 'metadata',
    type: 'jsonb',
    default: {},
  })
  metadata!: Record<string, unknown>;

  @Column({
    name: 'confirmed_tx_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  confirmedTxHash!: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
