import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const logger = new Logger('RedisClient');

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const url = config.get<string>('redis.url');
    if (!url) {
      logger.warn('REDIS_URL не задан — semantic cache будет отключён');
      return null;
    }

    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
    return client;
  },
};
