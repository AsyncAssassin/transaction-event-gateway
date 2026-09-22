import { getValidatedDatabaseUrl } from './database-url.validation';

describe('getValidatedDatabaseUrl', () => {
  it('returns a valid PostgreSQL URL', () => {
    const databaseUrl = 'postgres://app:app@localhost:5432/app';

    expect(getValidatedDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(
      databaseUrl,
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => getValidatedDatabaseUrl({})).toThrow(
      'Invalid database configuration: "DATABASE_URL" is required',
    );
  });

  it('rejects a malformed DATABASE_URL without echoing its credentials', () => {
    let message = '';

    try {
      getValidatedDatabaseUrl({
        DATABASE_URL: 'postgresq://app:Migr-S3cret@db:5432/app',
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(
      'Invalid database configuration: "DATABASE_URL" must be a postgres:// or postgresql:// URL',
    );
    expect(message).not.toContain('Migr-S3cret');
  });
});
