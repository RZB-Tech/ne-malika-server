import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

const logger = new Logger('OpenAiClient');

/**
 * Как и Redis, клиент опционален: без ключа ИИ-проверка просто не запускается,
 * а товары публикуются напрямую. Заглушка с фиктивным ключом только маскировала
 * бы проблему до первого запроса.
 */
export const openaiClientProvider: Provider = {
  provide: OPENAI_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): OpenAI | null => {
    const apiKey = config.get<string>('openai.apiKey');
    if (!apiKey) {
      logger.warn('OPENAI_API_KEY не задан — ИИ-проверка товаров отключена');
      return null;
    }
    return new OpenAI({ apiKey });
  },
};
