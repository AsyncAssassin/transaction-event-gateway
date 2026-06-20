import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import {
  ProcessWebhookEventJobData,
  WEBHOOK_EVENTS_QUEUE,
} from '../processing/queue.constants';

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

const REQUIRED_CONFIG_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'WEBHOOK_SECRET',
  'WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS',
] as const;
const REDIS_READINESS_TIMEOUT_MS = 1_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(WEBHOOK_EVENTS_QUEUE)
    private readonly webhookEventsQueue: Queue<ProcessWebhookEventJobData>,
  ) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
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

    try {
      if (!this.dataSource.isInitialized) {
        throw new Error('PostgreSQL connection is not initialized.');
      }

      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'PostgreSQL readiness check failed.',
        details: [{ dependency: 'postgres' }],
      });
    }

    try {
      const client = (await this.webhookEventsQueue.client) as unknown as {
        ping: () => Promise<string>;
      };
      await withTimeout(
        client.ping(),
        REDIS_READINESS_TIMEOUT_MS,
        'Redis readiness check timed out.',
      );
    } catch {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Redis readiness check failed.',
        details: [{ dependency: 'redis' }],
      });
    }

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
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}
