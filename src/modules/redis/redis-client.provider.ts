import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const logger = new Logger('RedisClient');

/**
 * Клиент опционален: без REDIS_URL провайдер отдаёт null, а RedisService
 * молча работает вхолостую. Кэш — ускорение, а не условие работы приложения.
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis | null => {
    const url = config.get<string>('redis.url');
    if (!url) {
      logger.warn('REDIS_URL не задан — кэш отключён');
      return null;
    }

    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      // Ошибки соединения не должны валить старт приложения.
      enableOfflineQueue: false,
    });
    client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
    client.on('ready', () => logger.log(`Redis подключён: ${url}`));
    return client;
  },
};
