import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { RedisService } from '../redis/redis.service';
import { AppSettingsDto } from './dto/app-settings.dto';

const AI_CHECKS_KEY = 'ai_checks_enabled';
const CACHE_KEY = 'settings:ai_checks_enabled';
const CACHE_TTL_SEC = 300;

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly redis: RedisService,
  ) {}

  /**
   * Читается на каждое сохранение товара, меняется раз в месяц — держим в Redis.
   * Источник правды всё равно БД: настройка должна переживать перезапуск кэша.
   */
  async isAiChecksEnabled(): Promise<boolean> {
    const cached = await this.redis.get<boolean>(CACHE_KEY);
    if (cached !== null) return cached;

    const stored = await this.repository.get<boolean>(AI_CHECKS_KEY);
    const value = stored ?? true; // по умолчанию проверка включена
    await this.redis.set(CACHE_KEY, value, CACHE_TTL_SEC);
    return value;
  }

  async getAll(): Promise<AppSettingsDto> {
    return { aiChecksEnabled: await this.isAiChecksEnabled() };
  }

  async update(dto: AppSettingsDto): Promise<AppSettingsDto> {
    await this.repository.set(AI_CHECKS_KEY, dto.aiChecksEnabled);
    await this.redis.del(CACHE_KEY);
    return { aiChecksEnabled: dto.aiChecksEnabled };
  }
}
