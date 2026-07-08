import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis-client.provider';

const CACHE_TTL_SEC = 7 * 24 * 60 * 60; // 7 дней
const KEY_PREFIX = 'search:embedding:';

@Injectable()
export class SemanticCacheService {
  private readonly logger = new Logger(SemanticCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async get(prompt: string): Promise<number[] | null> {
    if (!this.redis) return null;

    try {
      const key = this.buildKey(prompt);
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (err) {
      this.logger.warn(`Semantic cache get failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set(prompt: string, embedding: number[]): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.buildKey(prompt);
      await this.redis.set(key, JSON.stringify(embedding), 'EX', CACHE_TTL_SEC);
    } catch (err) {
      this.logger.warn(`Semantic cache set failed: ${(err as Error).message}`);
    }
  }

  private buildKey(prompt: string): string {
    const normalized = prompt.trim().toLowerCase();
    const hash = createHash('sha256').update(normalized).digest('hex');
    return `${KEY_PREFIX}${hash}`;
  }
}
