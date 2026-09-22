import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .required(),
  REDIS_URL: Joi.string()
    .pattern(/^rediss?:\/\/.+/)
    .required(),
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
  OUTBOX_MAX_ATTEMPTS: Joi.number().integer().positive().default(10),
  RATE_LIMIT_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_LIMIT: Joi.number().integer().positive().default(100),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
});
