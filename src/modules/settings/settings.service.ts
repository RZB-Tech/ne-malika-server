import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { RedisService } from '../redis/redis.service';
import { AppSettingsDto } from './dto/app-settings.dto';

import {
  CREDIT_MARKUP_KEY,
  DEFAULT_CREDIT_MARKUP,
} from '../credits/credits.constants';

const AI_CHECKS_KEY = 'ai_checks_enabled';
const CACHE_KEY = 'settings:ai_checks_enabled';
const MARKUP_CACHE_KEY = 'settings:credit_markup';
const CACHE_TTL_SEC = 300;

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly redis: RedisService,
  ) {}

  async isAiChecksEnabled(): Promise<boolean> {
    const cached = await this.redis.get<boolean>(CACHE_KEY);
    if (cached !== null) return cached;

    const stored = await this.repository.get<boolean>(AI_CHECKS_KEY);
    const value = stored ?? true;
    await this.redis.set(CACHE_KEY, value, CACHE_TTL_SEC);
    return value;
  }

  async getCreditMarkup(): Promise<number> {
    const cached = await this.redis.get<number>(MARKUP_CACHE_KEY);
    if (cached !== null) return cached;

    const stored = await this.repository.get<number>(CREDIT_MARKUP_KEY);
    const value =
      typeof stored === 'number' && stored >= 1
        ? stored
        : DEFAULT_CREDIT_MARKUP;
    await this.redis.set(MARKUP_CACHE_KEY, value, CACHE_TTL_SEC);
    return value;
  }

  async getAll(): Promise<AppSettingsDto> {
    const [aiChecksEnabled, creditMarkup] = await Promise.all([
      this.isAiChecksEnabled(),
      this.getCreditMarkup(),
    ]);
    return { aiChecksEnabled, creditMarkup };
  }

  async update(dto: AppSettingsDto): Promise<AppSettingsDto> {
    await this.repository.set(AI_CHECKS_KEY, dto.aiChecksEnabled);
    await this.redis.del(CACHE_KEY);

    if (dto.creditMarkup !== undefined) {
      await this.repository.set(CREDIT_MARKUP_KEY, dto.creditMarkup);
      await this.redis.del(MARKUP_CACHE_KEY);
    }

    return this.getAll();
  }
}
