import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import {
  CANONICAL_CONFIRMED_TX_HASH_SQL,
  NormalizeConfirmedTxHashes1790150000000,
} from '../migrations/1790150000000-NormalizeConfirmedTxHashes';
import { normalizeTxHash } from '../src/webhooks/tx-hash';

// Every character that String.prototype.trim removes, and three that it keeps.
const JS_WHITESPACE = [
  '\t',
  '\n',
  '\v',
  '\f',
  '\r',
  ' ',
  '\u00a0',
  '\u1680',
  '\u2000',
  '\u2005',
  '\u200a',
  '\u2028',
  '\u2029',
  '\u202f',
  '\u205f',
  '\u3000',
  '\ufeff',
];
const NOT_WHITESPACE = ['\u0085', '\u180e', '\u200b'];

describe('Confirmed transaction hash migration (e2e)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ default: dataSource } = await import('../src/database/data-source'));
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await truncatePaymentIntentTables(dataSource);
  });

  afterAll(async () => {
    await truncatePaymentIntentTables(dataSource);
    await dataSource.destroy();
  });

  it('computes the same canonical hash in SQL as normalizeTxHash', async () => {
    const inputs = [
      ...JS_WHITESPACE.map((space) => `${space}0xABCDEF01${space}`),
      ...NOT_WHITESPACE.map((character) => `${character}0xABCDEF02`),
      ' Base58CaseKept\u3000',
      '0XAbCd03',
      '0xNotHex04',
    ];

    for (const input of inputs) {
      const rows = (await dataSource.query(
        `SELECT ${CANONICAL_CONFIRMED_TX_HASH_SQL} AS "txHash" FROM (SELECT $1::text AS confirmed_tx_hash) AS input`,
        [input],
      )) as Array<{ txHash: string }>;

      expect({ input, txHash: rows[0]?.txHash }).toEqual({
        input,
        txHash: normalizeTxHash(input),
      });
    }
  });

  it('normalizes each hash once and leaves the other intents of a shared hash unchanged', async () => {
    const ids = {
      upperHex: await insertConfirmedIntent(dataSource, '0xABCDEF01'),
      paddedHex: await insertConfirmedIntent(dataSource, ' 0XFEED02\t'),
      unicodePadded: await insertConfirmedIntent(
        dataSource,
        '\u00a00xFACE03\u2003',
      ),
      base58: await insertConfirmedIntent(dataSource, ' Base58CaseKept '),
      canonical: await insertConfirmedIntent(dataSource, '0xc0ffee04'),
      // One transaction confirmed two intents; one of them has the canonical
      // spelling already.
      sharedUpper: await insertConfirmedIntent(dataSource, '0xBEEF05'),
      sharedLower: await insertConfirmedIntent(dataSource, '0xbeef05'),
      // One transaction confirmed two intents, neither in canonical spelling.
      laterUnspelled: await insertConfirmedIntent(
        dataSource,
        ' 0XCAFE06 ',
        '1 hour',
      ),
      earlierUnspelled: await insertConfirmedIntent(
        dataSource,
        '0xCAFE06',
        '2 hours',
      ),
    };

    await runMigration(dataSource);

    expect(await hashesById(dataSource)).toEqual({
      [ids.upperHex]: '0xabcdef01',
      [ids.paddedHex]: '0xfeed02',
      [ids.unicodePadded]: '0xface03',
      [ids.base58]: 'Base58CaseKept',
      [ids.canonical]: '0xc0ffee04',
      [ids.sharedUpper]: '0xBEEF05',
      [ids.sharedLower]: '0xbeef05',
      [ids.laterUnspelled]: ' 0XCAFE06 ',
      [ids.earlierUnspelled]: '0xcafe06',
    });
  });

  it('changes nothing when it runs again', async () => {
    await insertConfirmedIntent(dataSource, '0xABCDEF07');
    await insertConfirmedIntent(dataSource, '0xDEAD08', '2 hours');
    await insertConfirmedIntent(dataSource, '0XDEAD08', '1 hour');

    await runMigration(dataSource);
    const afterFirstRun = await hashesById(dataSource);
    await runMigration(dataSource);

    expect(await hashesById(dataSource)).toEqual(afterFirstRun);
  });
});

async function runMigration(dataSource: DataSource): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();

  try {
    await new NormalizeConfirmedTxHashes1790150000000().up(queryRunner);
  } finally {
    await queryRunner.release();
  }
}

async function hashesById(
  dataSource: DataSource,
): Promise<Record<string, string>> {
  const rows = (await dataSource.query(
    'SELECT id, confirmed_tx_hash AS "txHash" FROM payment_intents',
  )) as Array<{ id: string; txHash: string }>;

  return Object.fromEntries(rows.map((row) => [row.id, row.txHash]));
}

async function insertConfirmedIntent(
  dataSource: DataSource,
  confirmedTxHash: string,
  confirmedAgo = '0 seconds',
): Promise<string> {
  const id = randomUUID();

  await dataSource.query(
    `
      INSERT INTO payment_intents (
        id, status, amount, asset, destination, metadata, confirmed_tx_hash,
        updated_at
      )
      VALUES (
        $1, 'CONFIRMED', '125.50', 'USDC', 'wallet_test_123', '{}'::jsonb, $2,
        now() - $3::interval
      )
    `,
    [id, confirmedTxHash, confirmedAgo],
  );

  return id;
}

async function truncatePaymentIntentTables(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE idempotency_records, payment_intents RESTART IDENTITY CASCADE',
  );
}
