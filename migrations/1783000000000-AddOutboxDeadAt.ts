import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxDeadAt1783000000000 implements MigrationInterface {
  name = 'AddOutboxDeadAt1783000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE outbox_events ADD COLUMN dead_at timestamptz NULL',
    );
    await queryRunner.query(
      `CREATE INDEX outbox_events_dead_at_idx
        ON outbox_events (dead_at)
        WHERE dead_at IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS outbox_events_dead_at_idx');
    await queryRunner.query(
      'ALTER TABLE outbox_events DROP COLUMN IF EXISTS dead_at',
    );
  }
}
