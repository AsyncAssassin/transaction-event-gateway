import Joi from 'joi';

import { DATABASE_URL_PATTERN_MESSAGES } from '../database/database-url.validation';

// Joi's default pattern message echoes the rejected value, which would print
// connection credentials into the logs on a misconfigured URL.
const REDIS_URL_PATTERN_MESSAGES = {
  'string.pattern.base': '{{#label}} must be a redis:// or rediss:// URL',
};

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .messages(DATABASE_URL_PATTERN_MESSAGES)
    .required(),
  REDIS_URL: Joi.string()
    .pattern(/^rediss?:\/\/.+/)
    .messages(REDIS_URL_PATTERN_MESSAGES)
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
  // Without a value, the log format follows NODE_ENV (resolveLogFormat).
  LOG_FORMAT: Joi.string().valid('json', 'text'),
});
