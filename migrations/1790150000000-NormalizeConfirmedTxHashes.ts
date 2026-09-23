import { MigrationInterface, QueryRunner } from 'typeorm';

// The canonical form from src/webhooks/tx-hash.ts: surrounding whitespace
// removed, and 0x-prefixed hexadecimal hashes lowercased.
const CANONICAL_TX_HASH = `
  CASE
    WHEN btrim(confirmed_tx_hash, E' \\t\\n\\r') ~ '^0[xX][0-9a-fA-F]+$'
      THEN lower(btrim(confirmed_tx_hash, E' \\t\\n\\r'))
    ELSE btrim(confirmed_tx_hash, E' \\t\\n\\r')
  END
`;

export class NormalizeConfirmedTxHashes1790150000000 implements MigrationInterface {
  name = 'NormalizeConfirmedTxHashes1790150000000';

  // Rows whose canonical hash another row shares are left as they are: the
  // same transaction confirmed more than one payment intent before hashes
  // were normalized, and an operator has to decide which confirmation stands
  // (the runbook shows how to find them). Normalizing them would break the
  // unique index on confirmed_tx_hash.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH canonical AS (
        SELECT id, ${CANONICAL_TX_HASH} AS tx_hash
        FROM payment_intents
        WHERE confirmed_tx_hash IS NOT NULL
      ),
      unshared AS (
        SELECT tx_hash
        FROM canonical
        GROUP BY tx_hash
        HAVING count(*) = 1
      )
      UPDATE payment_intents intent
      SET confirmed_tx_hash = canonical.tx_hash
      FROM canonical
      JOIN unshared ON unshared.tx_hash = canonical.tx_hash
      WHERE intent.id = canonical.id
        AND intent.confirmed_tx_hash <> canonical.tx_hash
    `);
  }

  // The original spelling is not kept, so there is nothing to restore.
  async down(): Promise<void> {}
}
