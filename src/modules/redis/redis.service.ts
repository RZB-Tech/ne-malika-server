import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis-client.provider';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.warn('get', key, err);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (err) {
      this.warn('set', key, err);
    }
  }

  async claim(key: string, ttlSec: number): Promise<boolean> {
    if (!this.client) return true;
    try {
      const res = await this.client.set(key, '1', 'EX', ttlSec, 'NX');
      return res === 'OK';
    } catch (err) {
      this.warn('claim', key, err);
      return true;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.warn('del', key, err);
    }
  }

  async delByPrefix(prefix: string): Promise<void> {
    if (!this.client) return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          200,
        );
        cursor = next;
        if (keys.length > 0) await this.client.del(...keys);
      } while (cursor !== '0');
    } catch (err) {
      this.warn('delByPrefix', prefix, err);
    }
  }

  private warn(op: string, key: string, err: unknown) {
    this.logger.warn(
      `Redis ${op} ${key}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
