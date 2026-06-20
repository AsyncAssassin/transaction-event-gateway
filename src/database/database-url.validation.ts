import Joi from 'joi';

type DatabaseEnv = {
  DATABASE_URL: string;
};

const databaseEnvSchema = Joi.object<DatabaseEnv>({
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/.+/)
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
