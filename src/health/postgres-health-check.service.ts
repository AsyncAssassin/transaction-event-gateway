import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';

export const POSTGRES_HEALTH_APPLICATION_NAME =
  'transaction-event-gateway-health';

const POSTGRES_HEALTH_POOL_MAX = 1;
const POSTGRES_HEALTH_CONNECTION_TIMEOUT_MS = 1_000;
const POSTGRES_HEALTH_IDLE_TIMEOUT_MS = 30_000;
const POSTGRES_HEALTH_STATEMENT_TIMEOUT_MS = 2_000;

@Injectable()
export class PostgresHealthCheckService implements OnModuleDestroy {
  private readonly logger = new StructuredLogger(
    PostgresHealthCheckService.name,
  );
  private pool: Pool | undefined;

  constructor(private readonly configService: ConfigService) {}

  async check(): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query(
        `SET statement_timeout = ${POSTGRES_HEALTH_STATEMENT_TIMEOUT_MS}`,
      );
      await client.query('SELECT 1');
      client.release();
    } catch (error) {
      // A query_timeout does not close the connection: the timed-out query
      // stays active, so a client returned to the pool would fail every later
      // check (for example after a silently dropped connection). Destroy it so
      // the next check opens a fresh connection.
      client.release(true);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  private getPool(): Pool {
    if (this.pool) {
      return this.pool;
    }

    const databaseUrl = this.configService.getOrThrow<string>('DATABASE_URL');
    const pool = new Pool({
      connectionString: databaseUrl,
      application_name: POSTGRES_HEALTH_APPLICATION_NAME,
      max: POSTGRES_HEALTH_POOL_MAX,
      connectionTimeoutMillis: POSTGRES_HEALTH_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: POSTGRES_HEALTH_IDLE_TIMEOUT_MS,
      statement_timeout: POSTGRES_HEALTH_STATEMENT_TIMEOUT_MS,
      query_timeout: POSTGRES_HEALTH_STATEMENT_TIMEOUT_MS,
      allowExitOnIdle: true,
    });

    // pg-pool re-emits failures of idle clients (for example PostgreSQL
    // terminating the connection during a restart or failover) as an 'error'
    // event on the pool itself. Without a listener Node treats that as an
    // unhandled 'error' event and exits the process. pg-pool already evicts the
    // broken client, so logging is enough: the next check() reconnects.
    pool.on('error', (error) => {
      this.logger.warn('postgres_health_pool_error', {
        status: 'FAILED',
        errorCode: toSafeErrorCode(error, 'POSTGRES_HEALTH_POOL_ERROR'),
      });
    });

    this.pool = pool;

    return pool;
  }
}
