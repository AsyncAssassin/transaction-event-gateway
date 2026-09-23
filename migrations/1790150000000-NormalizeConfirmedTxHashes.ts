import { MigrationInterface, QueryRunner } from 'typeorm';

// The characters that String.prototype.trim removes: ECMAScript white space
// and line terminators.
const JS_WHITESPACE =
  "U&' \\0009\\000A\\000B\\000C\\000D\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'";

const TRIMMED = `btrim(confirmed_tx_hash, ${JS_WHITESPACE})`;

// SQL for normalizeTxHash (src/webhooks/tx-hash.ts) applied to
// confirmed_tx_hash: surrounding white space removed, and 0x-prefixed
// hexadecimal hashes lowercased. Exported as a string for the tests: TypeORM
// loads every exported function of a migration file as a migration.
export const CANONICAL_CONFIRMED_TX_HASH_SQL = `CASE WHEN ${TRIMMED} ~ '^0[xX][0-9a-fA-F]+$' THEN lower(${TRIMMED}) ELSE ${TRIMMED} END`;

export class NormalizeConfirmedTxHashes1790150000000 implements MigrationInterface {
  name = 'NormalizeConfirmedTxHashes1790150000000';

  // Each canonical hash goes to exactly one payment intent. Where one
  // transaction already confirmed several intents in different spellings, the
  // intent that holds the canonical spelling keeps it, or else the earliest
  // confirmation gets it, so later webhooks with that transaction are
  // recognized; the other intents keep their spelling for an operator to
  // review (see the runbook). Normalizing all of them would break the unique
  // index on confirmed_tx_hash. The canonical form is idempotent, so a row can
  // already hold a canonical value only within that value's own group.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH canonical AS (
        SELECT
          id,
          confirmed_tx_hash,
          updated_at,
          ${CANONICAL_CONFIRMED_TX_HASH_SQL} AS tx_hash
        FROM payment_intents
        WHERE confirmed_tx_hash IS NOT NULL
      ),
      holder AS (
        SELECT DISTINCT ON (tx_hash) id, tx_hash
        FROM canonical
        ORDER BY tx_hash, confirmed_tx_hash = tx_hash DESC, updated_at, id
      )
      UPDATE payment_intents intent
      SET confirmed_tx_hash = holder.tx_hash
      FROM holder
      WHERE intent.id = holder.id
        AND intent.confirmed_tx_hash <> holder.tx_hash
    `);
  }

  // Nothing to undo: the previous code works with canonical hashes as well, and
  // the spelling a hash arrived in stays in the webhook_events row (tx_hash and
  // payload) of the event that confirmed the intent.
  async down(): Promise<void> {}
}
