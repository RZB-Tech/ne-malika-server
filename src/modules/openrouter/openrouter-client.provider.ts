import { Agent } from 'https';
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENROUTER_CLIENT = Symbol('OPENROUTER_CLIENT');

const logger = new Logger('OpenRouterClient');

/**
 * Соединение может простаивать, пока модель думает над картинкой, — а простой
 * без трафика рвут NAT и фаерволы. Keep-alive держит сессию видимо живой.
 */
const keepAliveAgent = new Agent({ keepAlive: true, keepAliveMsecs: 15_000 });

/**
 * OpenRouter говорит по протоколу OpenAI, поэтому клиентом остаётся тот же SDK.
 * Как и остальные внешние сервисы, он опционален: без ключа проверка товаров и
 * составление промпта просто не запускаются, а приложение работает.
 */
export const openrouterClientProvider: Provider = {
  provide: OPENROUTER_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): OpenAI | null => {
    const apiKey = config.get<string>('openrouter.apiKey');
    if (!apiKey) {
      logger.warn('OPENROUTER_API_KEY не задан — ИИ-функции отключены');
      return null;
    }

    return new OpenAI({
      apiKey,
      baseURL: config.get<string>('openrouter.baseUrl'),
      httpAgent: keepAliveAgent,
      defaultHeaders: {
        'HTTP-Referer': 'https://nemalika.uz',
        'X-Title': 'neMalika',
      },
    });
  },
};
