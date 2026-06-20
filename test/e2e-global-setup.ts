import { setTestEnvDefaults } from './test-env';

export default async function setupE2eDatabase(): Promise<void> {
  setTestEnvDefaults();

  const { default: dataSource } = await import('../src/database/data-source');

  try {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    await dataSource.runMigrations();
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}
