import 'reflect-metadata';

import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { getValidatedDatabaseUrl } from './database-url.validation';
import { createPostgresDataSourceOptions } from './typeorm-options';

loadEnv({ quiet: true });

const databaseUrl = getValidatedDatabaseUrl();

const dataSource = new DataSource(
  createPostgresDataSourceOptions(
    databaseUrl,
    [`${__dirname}/entities/*.entity{.ts,.js}`],
    [`${process.cwd()}/migrations/*{.ts,.js}`],
  ),
);

export default dataSource;
