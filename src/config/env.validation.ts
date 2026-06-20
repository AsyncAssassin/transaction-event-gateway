import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .required(),
  REDIS_URL: Joi.string().pattern(/^redis:\/\/.+/).required(),
  WEBHOOK_SECRET: Joi.string().min(16).required(),
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(300),
  OUTBOX_DISPATCH_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  OUTBOX_DISPATCH_INTERVAL_MS: Joi.number().integer().positive().default(1000),
});
