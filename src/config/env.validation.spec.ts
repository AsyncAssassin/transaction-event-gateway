import { envValidationSchema } from './env.validation';

const validEnv = {
  DATABASE_URL: 'postgres://app:app@localhost:5432/transaction_event_gateway',
  REDIS_URL: 'redis://localhost:6379',
  WEBHOOK_SECRET: 'test-webhook-secret-value',
};

function validationMessage(env: Record<string, unknown>): string {
  const { error } = envValidationSchema.validate(env, { abortEarly: false });

  return error?.message ?? '';
}

describe('envValidationSchema', () => {
  it('accepts the documented URL schemes', () => {
    expect(validationMessage(validEnv)).toBe('');
    expect(
      validationMessage({
        ...validEnv,
        DATABASE_URL: 'postgresql://app:app@db:5432/app',
        REDIS_URL: 'rediss://:token@cache:6379',
      }),
    ).toBe('');
  });

  it('rejects a malformed DATABASE_URL without echoing its credentials', () => {
    const message = validationMessage({
      ...validEnv,
      DATABASE_URL: '{"username":"app","password":"Db-S3cret#pw"}',
    });

    expect(message).toContain(
      '"DATABASE_URL" must be a postgres:// or postgresql:// URL',
    );
    expect(message).not.toContain('Db-S3cret');
  });

  it('rejects a malformed REDIS_URL without echoing its credentials', () => {
    const message = validationMessage({
      ...validEnv,
      REDIS_URL: 'https://:Redis-S3cret@cache:6379',
    });

    expect(message).toContain(
      '"REDIS_URL" must be a redis:// or rediss:// URL',
    );
    expect(message).not.toContain('Redis-S3cret');
  });
});
