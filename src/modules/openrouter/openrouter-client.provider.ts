import { Agent } from 'https';
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENROUTER_CLIENT = Symbol('OPENROUTER_CLIENT');

const logger = new Logger('OpenRouterClient');

const keepAliveAgent = new Agent({ keepAlive: true, keepAliveMsecs: 15_000 });

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
