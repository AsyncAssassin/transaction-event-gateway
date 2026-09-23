import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { NormalizeConfirmedTxHashes1790150000000 } from '../migrations/1790150000000-NormalizeConfirmedTxHashes';

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

  it('normalizes stored hashes and leaves hashes that several intents share', async () => {
    const ids = {
      upperHex: await insertConfirmedIntent(dataSource, '0xABCDEF01'),
      paddedHex: await insertConfirmedIntent(dataSource, ' 0XFEED02\t'),
      base58: await insertConfirmedIntent(dataSource, ' Base58CaseKept '),
      canonical: await insertConfirmedIntent(dataSource, '0xc0ffee03'),
      sharedUpper: await insertConfirmedIntent(dataSource, '0xBEEF04'),
      sharedLower: await insertConfirmedIntent(dataSource, '0xbeef04'),
    };

    const queryRunner = dataSource.createQueryRunner();
    try {
      await new NormalizeConfirmedTxHashes1790150000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const rows = (await dataSource.query(
      'SELECT id, confirmed_tx_hash AS "txHash" FROM payment_intents',
    )) as Array<{ id: string; txHash: string }>;
    const hashById = Object.fromEntries(
      rows.map((row) => [row.id, row.txHash]),
    );

    expect(hashById).toEqual({
      [ids.upperHex]: '0xabcdef01',
      [ids.paddedHex]: '0xfeed02',
      [ids.base58]: 'Base58CaseKept',
      [ids.canonical]: '0xc0ffee03',
      [ids.sharedUpper]: '0xBEEF04',
      [ids.sharedLower]: '0xbeef04',
    });
  });
});

async function insertConfirmedIntent(
  dataSource: DataSource,
  confirmedTxHash: string,
): Promise<string> {
  const id = randomUUID();

  await dataSource.query(
    `
      INSERT INTO payment_intents (
        id, status, amount, asset, destination, metadata, confirmed_tx_hash
      )
      VALUES ($1, 'CONFIRMED', '125.50', 'USDC', 'wallet_test_123', '{}'::jsonb, $2)
    `,
    [id, confirmedTxHash],
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
