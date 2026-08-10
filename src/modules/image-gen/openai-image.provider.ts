import { Agent } from 'https';
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENAI_IMAGE_CLIENT = Symbol('OPENAI_IMAGE_CLIENT');

const logger = new Logger('OpenAiImageClient');

/**
 * Генерация картинки идёт до полутора минут, и всё это время по соединению не
 * передаётся ни байта. NAT и фаерволы считают такую сессию мёртвой и рвут её —
 * наружу это прилетало как `read ECONNRESET`.
 *
 * Keep-alive заставляет ядро слать пробные пакеты, так что соединение всё время
 * выглядит живым. 15 секунд — с запасом меньше обычного порога простоя (60 с).
 */
const keepAliveAgent = new Agent({
  keepAlive: true,
  keepAliveMsecs: 15_000,
  timeout: 300_000,
});

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
    return new OpenAI({ apiKey, httpAgent: keepAliveAgent });
  },
};
