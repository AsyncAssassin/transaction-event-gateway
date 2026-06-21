import 'reflect-metadata';

import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { getValidatedDatabaseUrl } from './database-url.validation';
import { createPostgresDataSourceOptions } from './typeorm-options';

loadEnv({ quiet: true });

const databaseUrl = getValidatedDatabaseUrl();
const isCompiledJavaScript = __filename.endsWith('.js');
const migrationsGlob = isCompiledJavaScript
  ? `${resolve(__dirname, '../migrations')}/*.js`
  : `${resolve(process.cwd(), 'migrations')}/*{.ts,.js}`;

const dataSource = new DataSource(
  createPostgresDataSourceOptions(
    databaseUrl,
    [`${__dirname}/entities/*.entity{.ts,.js}`],
    [migrationsGlob],
  ),
);

export default dataSource;
