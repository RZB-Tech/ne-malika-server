import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENAI_IMAGE_CLIENT = Symbol('OPENAI_IMAGE_CLIENT');

const logger = new Logger('OpenAiImageClient');

/**
 * Второй клиент рядом с Groq и по той же логике: без ключа генерация просто
 * недоступна, а остальное приложение работает. Заглушка с фиктивным ключом
 * маскировала бы проблему до первого запроса из админки.
 */
export const openaiImageClientProvider: Provider = {
  provide: OPENAI_IMAGE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): OpenAI | null => {
    const apiKey = config.get<string>('openaiImages.apiKey');
    if (!apiKey) {
      logger.warn('OPENAI_API_KEY не задан — генерация фотографий отключена');
      return null;
    }
    return new OpenAI({ apiKey });
  },
};
