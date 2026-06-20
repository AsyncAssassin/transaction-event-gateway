import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatabaseFoundation1781850000000
  implements MigrationInterface
{
  name = 'CreateDatabaseFoundation1781850000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(
      `CREATE TYPE payment_intent_status AS ENUM ('CREATED', 'PROCESSING', 'CONFIRMED', 'FAILED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TYPE webhook_event_status AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE outbox_event_status AS ENUM ('PENDING', 'PUBLISHED', 'FAILED')`,
    );

    await queryRunner.query(`
      CREATE TABLE payment_intents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status payment_intent_status NOT NULL,
        amount numeric(36, 18) NOT NULL,
        asset varchar(32) NOT NULL,
        destination varchar(255) NOT NULL,
        reference varchar(255) NULL,
        client_request_id varchar(255) NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        confirmed_tx_hash varchar(255) NULL,
        failure_reason text NULL,
        expires_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payment_intents_amount_positive_chk CHECK (amount > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE idempotency_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope varchar(128) NOT NULL,
        idempotency_key varchar(255) NOT NULL,
        request_hash varchar(128) NOT NULL,
        response_status integer NULL,
        response_body jsonb NULL,
        resource_type varchar(128) NULL,
        resource_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE webhook_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(128) NOT NULL,
        external_event_id varchar(255) NOT NULL,
        nonce varchar(255) NULL,
        event_type varchar(128) NOT NULL,
        payment_intent_id uuid NULL,
        tx_hash varchar(255) NULL,
        payload jsonb NOT NULL,
        payload_hash varchar(128) NOT NULL,
        status webhook_event_status NOT NULL,
        failure_reason text NULL,
        received_at timestamptz NOT NULL,
        processed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(128) NOT NULL,
        aggregate_type varchar(128) NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL,
        status outbox_event_status NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT outbox_events_attempts_non_negative_chk CHECK (attempts >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE webhook_processing_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_event_id uuid NOT NULL,
        job_id varchar(255) NULL,
        status varchar(64) NOT NULL,
        error_message text NULL,
        started_at timestamptz NOT NULL,
        finished_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT webhook_processing_attempts_status_chk
          CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED')),
        CONSTRAINT webhook_processing_attempts_finished_after_started_chk
          CHECK (finished_at IS NULL OR finished_at >= started_at)
      )
    `);

    await queryRunner.query(
      'CREATE INDEX payment_intents_status_idx ON payment_intents (status)',
    );
    await queryRunner.query(
      'CREATE INDEX payment_intents_created_at_idx ON payment_intents (created_at)',
    );
    await queryRunner.query(
      'CREATE INDEX payment_intents_client_request_id_idx ON payment_intents (client_request_id)',
    );
    await queryRunner.query(
      'CREATE INDEX payment_intents_reference_idx ON payment_intents (reference)',
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX payment_intents_confirmed_tx_hash_uniq
        ON payment_intents (confirmed_tx_hash)
        WHERE confirmed_tx_hash IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX idempotency_records_scope_key_uniq
        ON idempotency_records (scope, idempotency_key)`,
    );
    await queryRunner.query(
      'CREATE INDEX idempotency_records_expires_at_idx ON idempotency_records (expires_at)',
    );
    await queryRunner.query(
      `CREATE INDEX idempotency_records_resource_idx
        ON idempotency_records (resource_type, resource_id)`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX webhook_events_provider_external_event_id_uniq
        ON webhook_events (provider, external_event_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX webhook_events_provider_nonce_uniq
        ON webhook_events (provider, nonce)
        WHERE nonce IS NOT NULL`,
    );
    await queryRunner.query(
      'CREATE INDEX webhook_events_payment_intent_id_idx ON webhook_events (payment_intent_id)',
    );
    await queryRunner.query(
      `CREATE INDEX webhook_events_status_received_at_idx
        ON webhook_events (status, received_at)`,
    );
    await queryRunner.query(
      'CREATE INDEX webhook_events_tx_hash_idx ON webhook_events (tx_hash)',
    );
    await queryRunner.query(
      'CREATE INDEX webhook_events_payload_hash_idx ON webhook_events (payload_hash)',
    );

    await queryRunner.query(
      `CREATE INDEX outbox_events_status_next_attempt_idx
        ON outbox_events (status, next_attempt_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX outbox_events_aggregate_idx
        ON outbox_events (aggregate_type, aggregate_id)`,
    );

    await queryRunner.query(
      `CREATE INDEX webhook_processing_attempts_event_idx
        ON webhook_processing_attempts (webhook_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX webhook_processing_attempts_status_idx
        ON webhook_processing_attempts (status)`,
    );
    await queryRunner.query(`
      ALTER TABLE webhook_processing_attempts
      ADD CONSTRAINT webhook_processing_attempts_event_fk
      FOREIGN KEY (webhook_event_id) REFERENCES webhook_events(id)
      ON UPDATE NO ACTION ON DELETE RESTRICT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE webhook_processing_attempts
      DROP CONSTRAINT IF EXISTS webhook_processing_attempts_event_fk
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_processing_attempts_status_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_processing_attempts_event_idx',
    );
    await queryRunner.query('DROP INDEX IF EXISTS outbox_events_aggregate_idx');
    await queryRunner.query(
      'DROP INDEX IF EXISTS outbox_events_status_next_attempt_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_events_payload_hash_idx',
    );
    await queryRunner.query('DROP INDEX IF EXISTS webhook_events_tx_hash_idx');
    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_events_status_received_at_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_events_payment_intent_id_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_events_provider_nonce_uniq',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS webhook_events_provider_external_event_id_uniq',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idempotency_records_resource_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idempotency_records_expires_at_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idempotency_records_scope_key_uniq',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS payment_intents_confirmed_tx_hash_uniq',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS payment_intents_reference_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS payment_intents_client_request_id_idx',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS payment_intents_created_at_idx',
    );
    await queryRunner.query('DROP INDEX IF EXISTS payment_intents_status_idx');

    await queryRunner.query('DROP TABLE IF EXISTS webhook_processing_attempts');
    await queryRunner.query('DROP TABLE IF EXISTS outbox_events');
    await queryRunner.query('DROP TABLE IF EXISTS webhook_events');
    await queryRunner.query('DROP TABLE IF EXISTS idempotency_records');
    await queryRunner.query('DROP TABLE IF EXISTS payment_intents');

    await queryRunner.query('DROP TYPE IF EXISTS outbox_event_status');
    await queryRunner.query('DROP TYPE IF EXISTS webhook_event_status');
    await queryRunner.query('DROP TYPE IF EXISTS payment_intent_status');
  }
}
