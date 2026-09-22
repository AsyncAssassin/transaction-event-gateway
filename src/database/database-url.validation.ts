import Joi from 'joi';

type DatabaseEnv = {
  DATABASE_URL: string;
};

// Joi's default pattern message echoes the rejected value, which would print
// the database password into the logs on a misconfigured URL.
export const DATABASE_URL_PATTERN_MESSAGES = {
  'string.pattern.base':
    '{{#label}} must be a postgres:// or postgresql:// URL',
};

const databaseEnvSchema = Joi.object<DatabaseEnv>({
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .messages(DATABASE_URL_PATTERN_MESSAGES)
    .required(),
}).unknown(true);

export function getValidatedDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const validationResult = databaseEnvSchema.validate(env, {
    abortEarly: false,
  });

  if (validationResult.error) {
    const details = validationResult.error.details
      .map((detail) => detail.message)
      .join('; ');

    throw new Error(`Invalid database configuration: ${details}`);
  }

  return validationResult.value.DATABASE_URL;
}
