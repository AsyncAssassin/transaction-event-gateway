import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PostgresHealthCheckService } from './postgres-health-check.service';
import { RedisHealthCheckService } from './redis-health-check.service';

export type LivenessResponse = {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
};

export type ReadinessResponse = {
  status: 'ready';
  timestamp: string;
  checks: {
    config: 'ok';
    postgres: 'ok';
    redis: 'ok';
  };
};

export type ServingReadinessResponse = {
  status: 'ready';
  timestamp: string;
  checks: {
    config: 'ok';
    postgres: 'ok';
  };
};

const REQUIRED_CONFIG_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'WEBHOOK_SECRET',
  'WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS',
] as const;

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly postgresHealthCheck: PostgresHealthCheckService,
    private readonly redisHealthCheck: RedisHealthCheckService,
  ) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /**
   * Full readiness for operators and deploy gates: configuration, PostgreSQL,
   * and Redis. Not used by the ALB target group so a Redis incident does not
   * remove API tasks that can still serve PostgreSQL-only operations.
   */
  async getReadiness(): Promise<ReadinessResponse> {
    this.checkConfig();
    await this.checkPostgres();
    await this.checkRedis();

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        config: 'ok',
        postgres: 'ok',
        redis: 'ok',
      },
    };
  }

  /**
   * Serving readiness for the ALB target group: configuration plus PostgreSQL
   * only. The HTTP endpoints the load balancer serves (payment intent creation,
   * webhook acceptance) do not require Redis, so Redis is intentionally excluded.
   */
  async getServingReadiness(): Promise<ServingReadinessResponse> {
    this.checkConfig();
    await this.checkPostgres();

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        config: 'ok',
        postgres: 'ok',
      },
    };
  }

  private checkConfig(): void {
    const missingKeys = REQUIRED_CONFIG_KEYS.filter((key) => {
      const value = this.configService.get<unknown>(key);
      return value === undefined || value === null || value === '';
    });

    if (missingKeys.length > 0) {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Required configuration is missing.',
        details: missingKeys.map((key) => ({ field: key })),
      });
    }
  }

  private async checkPostgres(): Promise<void> {
    try {
      await this.postgresHealthCheck.check();
    } catch {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'PostgreSQL readiness check failed.',
        details: [{ dependency: 'postgres' }],
      });
    }
  }

  private async checkRedis(): Promise<void> {
    try {
      await this.redisHealthCheck.check();
    } catch {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Redis readiness check failed.',
        details: [{ dependency: 'redis' }],
      });
    }
  }
}
