import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const GROQ_CLIENT = Symbol('GROQ_CLIENT');

const logger = new Logger('GroqClient');

/**
 * Groq говорит по протоколу OpenAI, поэтому клиентом остаётся официальный SDK —
 * меняется только baseURL. Как и Redis, клиент опционален: без ключа ИИ-проверка
 * не запускается, а товары публикуются напрямую. Заглушка с фиктивным ключом
 * только маскировала бы проблему до первого запроса.
 */
export const groqClientProvider: Provider = {
  provide: GROQ_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): OpenAI | null => {
    const apiKey = config.get<string>('groq.apiKey');
    if (!apiKey) {
      logger.warn('GROQ_API_KEY не задан — ИИ-проверка товаров отключена');
      return null;
    }
    return new OpenAI({ apiKey, baseURL: config.get<string>('groq.baseUrl') });
  },
};
