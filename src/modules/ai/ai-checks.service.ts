import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENAI_CLIENT } from '../openai/openai-client.provider';
import { AiChecksRepository } from './ai-checks.repository';
import { SettingsService } from '../settings/settings.service';
import { RedisService } from '../redis/redis.service';
import { PRODUCT_CACHE_PREFIX } from '../product-cards/product-cards.cache';
import type { ProductCard } from '../../db/schema';
import {
  AI_ASPECTS,
  AiCheckResult,
  parseAiCheckResult,
} from './ai-check.types';

const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `Ты модератор карточек товаров на маркетплейсе компьютерной техники.
Оцени карточку и верни строго JSON без пояснений:
{"verdict":"pass|warn|fail","summary":"1-2 предложения по-русски",
 "checks":{"description":{"verdict":"...","notes":"..."},
           "dataConsistency":{"verdict":"...","notes":"..."},
           "photos":{"verdict":"...","notes":"..."},
           "photoMatch":{"verdict":"...","notes":"..."}}}

Что проверяешь:
- description — понятность и полнота описания, отсутствие спама и чужих контактов;
- dataConsistency — согласованность названия, цены, состояния и характеристик;
- photos — пригодность фотографий (есть ли они, не мусор ли);
- photoMatch — соответствуют ли фотографии описанию (если фото не переданы — verdict "warn", notes "фото недоступны для проверки").

verdict всей карточки: fail — только при явном нарушении (запрещённый товар, обман,
мошенничество, подмена товара); warn — есть замечания, но публиковать можно;
pass — замечаний нет. Итоговый verdict не мягче худшего из checks, кроме photoMatch без фото.`;

@Injectable()
export class AiChecksService {
  private readonly logger = new Logger(AiChecksService.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI | null,
    private readonly repository: AiChecksRepository,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  getLatestFor(productCardId: number) {
    return this.repository.findLatestByProductId(productCardId);
  }

  /** Очередь ручной модерации для админки. */
  listNeedingReview(limit: number, offset: number) {
    return this.repository.findNeedingReview(limit, offset);
  }

  /** Человек разобрался с проверкой — она уходит из очереди. */
  markReviewed(productCardId: number) {
    return this.repository.markLatestReviewed(productCardId);
  }

  /**
   * Запускается после сохранения товара и намеренно не ожидается вызывающим:
   * продавец не должен ждать ответа модели, чтобы увидеть свою карточку.
   */
  runInBackground(card: ProductCard): void {
    void this.run(card).catch((err: Error) =>
      this.logger.error(
        `ИИ-проверка товара ${card.id} упала: ${err.message}`,
        err.stack,
      ),
    );
  }

  private async run(card: ProductCard): Promise<void> {
    if (!this.openai) return;
    if (!(await this.settings.isAiChecksEnabled())) {
      this.logger.debug(`ИИ-проверка выключена — товар ${card.id} пропущен`);
      return;
    }

    const model = this.config.get<string>('openai.model')!;

    let result: AiCheckResult;
    let tokensUsed: number | null = null;
    try {
      const completion = await this.openai.chat.completions.create(
        {
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: this.buildUserContent(card) },
          ],
        },
        { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
      );
      tokensUsed = completion.usage?.total_tokens ?? null;
      result = parseAiCheckResult(completion.choices[0]?.message?.content);
    } catch (err) {
      // Ошибку фиксируем в истории проверок, но товар не прячем: недоступность
      // модели — наша проблема, а не нарушение продавца.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenAI не ответил по товару ${card.id}: ${message}`);
      await this.repository.create({
        productCardId: card.id,
        verdict: 'warn',
        checks: {},
        summary: 'Проверка не выполнена — сервис проверки недоступен',
        model,
        error: message,
      });
      return;
    }

    await this.repository.create({
      productCardId: card.id,
      verdict: result.verdict,
      checks: result.checks,
      summary: result.summary,
      model,
      tokensUsed,
    });

    if (result.verdict === 'fail') {
      await this.repository.hideProduct(card.id);
      await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
      this.logger.warn(`Товар ${card.id} скрыт по вердикту ИИ-проверки`);
    }
  }

  /**
   * Фото отдаём модели ссылками — они лежат в публичном S3. Если публичная база
   * не настроена (локальная разработка), проверяем только текст: недоступный
   * URL модель всё равно не откроет.
   */
  private buildUserContent(
    card: ProductCard,
  ): OpenAI.Chat.ChatCompletionContentPart[] {
    const characteristics = (card.characteristics ?? [])
      .map((c) => `${c.key}: ${c.value}`)
      .join('; ');

    const text = [
      `Название: ${card.name}`,
      `Цена: ${card.price}`,
      `Состояние: ${card.state === 'new' ? 'новый' : 'б/у'}`,
      `Описание: ${card.description ?? '(пусто)'}`,
      `Характеристики: ${characteristics || '(нет)'}`,
      `Аспекты для checks: ${AI_ASPECTS.join(', ')}`,
    ].join('\n');

    const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text },
    ];

    const publicBase = this.config.get<string>('s3.publicBase');
    if (publicBase) {
      const base = publicBase.replace(/\/$/, '');
      for (const key of (card.photos ?? []).slice(0, 4)) {
        parts.push({ type: 'image_url', image_url: { url: `${base}/${key}` } });
      }
    }

    return parts;
  }
}
