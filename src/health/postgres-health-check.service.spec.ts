import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import {
  POSTGRES_HEALTH_APPLICATION_NAME,
  PostgresHealthCheckService,
} from './postgres-health-check.service';

jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

type PoolErrorListener = (error: Error) => void;

describe('PostgresHealthCheckService', () => {
  const databaseUrl =
    'postgres://test:test@localhost:5432/transaction_event_gateway_test';

  let connect: jest.Mock;
  let end: jest.Mock<Promise<void>, []>;
  let on: jest.Mock<void, [string, PoolErrorListener]>;
  let query: jest.Mock;
  let release: jest.Mock<void, []>;
  let service: PostgresHealthCheckService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    release = jest.fn();
    connect = jest.fn().mockResolvedValue({ query, release });
    end = jest.fn().mockResolvedValue(undefined);
    on = jest.fn();

    jest.mocked(Pool).mockImplementation(
      () =>
        ({
          connect,
          end,
          on,
        }) as unknown as Pool,
    );

    service = new PostgresHealthCheckService({
      getOrThrow: jest.fn((key: string) =>
        key === 'DATABASE_URL' ? databaseUrl : undefined,
      ),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses an isolated bounded PostgreSQL pool', async () => {
    await service.check();

    expect(Pool).toHaveBeenCalledWith({
      connectionString: databaseUrl,
      application_name: POSTGRES_HEALTH_APPLICATION_NAME,
      max: 1,
      connectionTimeoutMillis: 1_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 2_000,
      query_timeout: 2_000,
      allowExitOnIdle: true,
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('absorbs idle-client pool errors so the process does not exit', async () => {
    await service.check();

    expect(on).toHaveBeenCalledWith('error', expect.any(Function));

    const errorListener = on.mock.calls.find(
      ([event]) => event === 'error',
    )?.[1];

    expect(errorListener).toBeDefined();
    expect(() =>
      errorListener?.(
        new Error('terminating connection due to administrator command'),
      ),
    ).not.toThrow();
  });

  it('sets a health-session statement timeout before selecting', async () => {
    await service.check();

    expect(query).toHaveBeenNthCalledWith(1, 'SET statement_timeout = 2000');
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT 1');
  });

  it('releases the health client after a successful check', async () => {
    await service.check();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the health client after a failed check', async () => {
    query.mockRejectedValueOnce(new Error('statement timeout failed'));

    await expect(service.check()).rejects.toThrow('statement timeout failed');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('closes the health pool on module destroy', async () => {
    await service.check();
    await service.onModuleDestroy();

    expect(end).toHaveBeenCalledTimes(1);
  });
});
