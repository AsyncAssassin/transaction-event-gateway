import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

import {
  IdempotencyRecordEntity,
  OutboxEventEntity,
  PaymentIntentEntity,
  WebhookEventEntity,
  WebhookProcessingAttemptEntity,
} from './entities';

type EntityList = NonNullable<DataSourceOptions['entities']>;
type MigrationList = NonNullable<DataSourceOptions['migrations']>;

export const DATABASE_ENTITIES: EntityList = [
  PaymentIntentEntity,
  IdempotencyRecordEntity,
  WebhookEventEntity,
  OutboxEventEntity,
  WebhookProcessingAttemptEntity,
];

export function createPostgresDataSourceOptions(
  databaseUrl: string,
  entities: EntityList = DATABASE_ENTITIES,
  migrations: MigrationList = [],
): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities,
    migrations,
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
  };
}

export function createTypeOrmModuleOptions(
  databaseUrl: string,
): TypeOrmModuleOptions {
  return {
    ...createPostgresDataSourceOptions(databaseUrl),
    // Runtime-only pool bounds and connect timeout. Not applied to the CLI
    // data source (src/database/data-source.ts) so migrations stay unbounded.
    // statement_timeout is intentionally omitted here: a global per-statement
    // timeout would abort worker transactions waiting on row locks.
    extra: {
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    },
  };
}
