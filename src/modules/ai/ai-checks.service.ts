import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
import { describeError } from '../openrouter/openrouter.util';
import { errorMessage } from '../../common/errors';
import { AiChecksRepository } from './ai-checks.repository';
import { SettingsService } from '../settings/settings.service';
import { RedisService } from '../redis/redis.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CategoriesService } from '../categories/categories.service';
import { escapeHtml, excerpt } from '../bot/telegram-html';
import { PRODUCT_CACHE_PREFIX } from '../product-cards/product-cards.cache';
import type { ProductCard } from '../../db/schema';
import {
  AI_ASPECTS,
  AiCheckResult,
  parseAiCheckResult,
} from './ai-check.types';

const REQUEST_TIMEOUT_MS = 60_000;

const STUCK_PENDING_MINUTES = 15;
const STUCK_PENDING_LIMIT = 100;
const MAX_PHOTOS = 1;

const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `Ты модератор карточек товаров на маркетплейсе компьютерной техники.
Оцени карточку и верни строго JSON без пояснений:
{"verdict":"pass|warn|fail","summary":"1-2 предложения по-русски",
 "checks":{"description":{"verdict":"...","notes":"..."},
           "dataConsistency":{"verdict":"...","notes":"..."},
           "photos":{"verdict":"...","notes":"..."},
           "photoMatch":{"verdict":"...","notes":"..."}}}

Что проверяешь:
- description — осмысленность названия и описания, понятность, отсутствие спама,
  тестовых заглушек, случайного набора символов и чужих контактов;
- dataConsistency — согласованность названия, состояния и характеристик между собой;
- photos — на фото должен быть реально продаваемый товар. Скриншоты кода, терминала,
  переписки или сайта, мемы, заставки, реклама, чёрные/пустые изображения и иной
  визуальный мусор получают fail;
- photoMatch — фотография должна соответствовать названию и описанию. Если на фото
  нельзя уверенно увидеть заявленный товар либо изображён другой товар — fail.

Случайные названия вроде "sdf", "sdfsdf", "asdf", "test"/"тест", бессмысленный
текст и карточки, по которым нельзя понять, что продаётся, всегда получают fail.
Карточка не про компьютерную технику, периферию или услуги для них также получает fail.
warn допустим только для небольшого недостатка уже понятной карточки, когда товар
однозначно виден на фотографии и соответствует названию.

Услуги на площадке разрешены наравне с техникой: ремонт, диагностика, чистка,
установка систем и программ, восстановление данных, сборка и апгрейд, настройка
сети. Понизить вердикт только за то, что продаётся работа, а не вещь, нельзя.
Когда перед тобой услуга — об этом скажет категория карточки, а если её нет,
то название и описание, — проверяй иначе:
- photos — годится всё, что показывает саму работу: техника в ремонте, рабочее
  место мастера, пример «до и после», а также рекламный баннер или прайс мастера,
  даже если на нём перечислены и другие его услуги и указаны его контакты. Это
  нормальная подача услуги, а не нарушение. Требовать фотографию продаваемой вещи
  здесь нечего. fail — только за мусор, не имеющий отношения к делу: скриншоты
  переписки и кода, мемы, порнографию, пустые и чёрные изображения;
- photoMatch у услуги никогда не строже warn. Отсутствие на снимке «того самого
  товара» нарушением не считается, и баннер про ремонт техники вообще не
  противоречит карточке про отдельную услугу — мастер рекламирует всё, что умеет;
- состояние «новый»/«б/у» к услуге не относится — это не рассогласование данных;
- отсутствие характеристик у услуги нормально: там описывают работу словами.

Услугами считаются в том числе установка и активация систем и программ, чистка,
диагностика, ремонт, восстановление данных, настройка. Карточку вида «Активация
Windows» браковать за то, что на фото не лежит коробка с товаром, нельзя.

Цену не оценивай и не комментируй. Рыночных цен ты не знаешь: они зависят от
состояния, комплектации, курса и площадки, а торг здесь дело продавца и покупателя.
Никогда не понижай вердикт из-за размера цены — ни высокой, ни низкой, ни «странной».
Цена важна ровно в одном случае: если продавец сам описывает обман (например,
«на фото один товар, по этой цене продаётся другой»), и это уже нарушение по сути,
а не по сумме.

verdict всей карточки: fail — при любом из перечисленных нарушений, мусорной или
непроверяемой карточке; warn — есть небольшие замечания, но публиковать можно;
pass — замечаний нет. Итоговый verdict не мягче худшего из checks.`;

@Injectable()
export class AiChecksService implements OnModuleInit {
  private readonly logger = new Logger(AiChecksService.name);

  constructor(
    @Inject(OPENROUTER_CLIENT) private readonly ai: OpenAI | null,
    private readonly repository: AiChecksRepository,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    private readonly files: FilesService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly categories: CategoriesService,
  ) {}

  onModuleInit(): void {
    if (process.env.SKIP_STARTUP_JOBS) return;

    void this.requeueStuckPending().catch((err: Error) =>
      this.logger.error(
        `Не удалось перезапустить застрявшие проверки: ${err.message}`,
        err.stack,
      ),
    );
  }

  getLatestFor(productCardId: number) {
    return this.repository.findLatestByProductId(productCardId);
  }

  listNeedingReview(limit: number, offset: number) {
    return this.repository.findNeedingReview(limit, offset);
  }

  markReviewed(productCardId: number) {
    return this.repository.markLatestReviewed(productCardId);
  }

  runInBackground(card: ProductCard): void {
    void this.run(card).catch((err: Error) =>
      this.logger.error(
        `ИИ-проверка товара ${card.id} упала: ${err.message}`,
        err.stack,
      ),
    );
  }

  private async requeueStuckPending(): Promise<void> {
    const olderThan = new Date(Date.now() - STUCK_PENDING_MINUTES * 60_000);
    const stuck = await this.repository.findStuckPending(
      olderThan,
      STUCK_PENDING_LIMIT,
    );
    if (stuck.length === 0) return;

    this.logger.warn(
      `Возобновляем проверку ${stuck.length} товаров, застрявших на проверке`,
    );
    for (const card of stuck) {
      try {
        await this.run(card);
      } catch (err) {
        this.logger.error(
          `Повтор проверки товара ${card.id} упал: ${errorMessage(err)}`,
        );
      }
    }
  }

  private async run(card: ProductCard): Promise<void> {
    const model = this.config.get<string>('openrouter.model') ?? 'unavailable';
    const localViolation = obviousContentViolation(card);
    if (localViolation) {
      await this.reject(card, model, localViolation);
      return;
    }

    if (!this.ai) {
      await this.deferToManualReview(
        card,
        model,
        'Проверка не выполнена — не настроен ключ OpenRouter',
        'OPENROUTER_API_KEY is not configured',
      );
      return;
    }
    if (!(await this.settings.isAiChecksEnabled())) {
      await this.deferToManualReview(
        card,
        model,
        'Автоматическая проверка выключена — требуется ручная модерация',
        'AI checks are disabled in settings',
      );
      return;
    }

    let result: AiCheckResult;
    let tokensUsed: number | null = null;
    try {
      const completion = await this.complete(model, card);
      tokensUsed = completion.usage?.total_tokens ?? null;
      result = parseAiCheckResult(completion.choices[0]?.message?.content);
    } catch (err) {
      const message = describeError(err);
      this.logger.error(
        `Модель не ответила по товару ${card.id} (модель ${model}, ` +
          `фотографий у карточки ${photoKeys(card).length}): ${message}`,
      );
      await this.deferToManualReview(
        card,
        model,
        'Проверка не выполнена — сервис проверки недоступен',
        message,
      );
      return;
    }

    const decision = {
      verdict: result.verdict,
      checks: result.checks,
      summary: result.summary,
      model,
      tokensUsed,
    } as const;

    if (result.verdict === 'fail') {
      await this.applyDecision(
        card,
        decision,
        'hidden',
        {
          level: 'warn',
          text: `Товар ${card.id} скрыт по вердикту ИИ-проверки`,
        },
        aiFailureText(card, 'модель забраковала товар', result.summary),
      );
      return;
    }

    await this.applyDecision(card, decision, 'active', {
      level: 'log',
      text: `Товар ${card.id} опубликован — вердикт ${result.verdict}`,
    });
  }

  private async complete(
    model: string,
    card: ProductCard,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    try {
      return await this.request(model, card, true);
    } catch (err) {
      if (!(err instanceof PhotosUnavailableError)) throw err;

      this.logger.warn(
        `Товар ${card.id} проверяется без фотографий: ${err.message}`,
      );
      return this.request(model, card, false);
    }
  }

  private async request(
    model: string,
    card: ProductCard,
    withPhotos: boolean,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const content = await this.buildUserContent(card, withPhotos);
    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    };

    return this.ai!.chat.completions.create(body, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }

  private async applyDecision(
    card: ProductCard,
    decision: Parameters<AiChecksRepository['recordDecision']>[1],
    status: 'active' | 'hidden' | undefined,
    log: { level: 'log' | 'warn'; text: string },
    notifyText?: string,
  ): Promise<void> {
    const applied = await this.repository.recordDecision(
      card,
      decision,
      status,
    );
    if (!applied) return this.logStale(card);

    // status не задан только при отложенной ручной проверке — карточка
    // остаётся pending, публиковать её в кэше ещё нечего.
    if (status) await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
    this.logger[log.level](log.text);
    if (notifyText) {
      void this.notifications.notifyAdmins(notifyText);
    }
  }

  private async deferToManualReview(
    card: ProductCard,
    model: string,
    summary: string,
    error: string,
  ): Promise<void> {
    await this.applyDecision(
      card,
      {
        verdict: 'warn',
        checks: {},
        summary,
        model,
        error,
      },
      undefined,
      { level: 'warn', text: `Товар ${card.id} не опубликован: ${summary}` },
      aiFailureText(card, 'требуется ручная проверка', `${summary}: ${error}`),
    );
  }

  private async reject(
    card: ProductCard,
    model: string,
    reason: string,
  ): Promise<void> {
    await this.applyDecision(
      card,
      {
        verdict: 'fail',
        checks: {
          description: { verdict: 'fail', notes: reason },
        },
        summary: reason,
        model,
      },
      'hidden',
      {
        level: 'warn',
        text: `Товар ${card.id} отклонён до ИИ-проверки: ${reason}`,
      },
      aiFailureText(card, 'карточка забракована', reason),
    );
  }

  private logStale(card: ProductCard): void {
    this.logger.log(
      `Результат проверки товара ${card.id} отброшен: карточка уже изменилась`,
    );
  }

  private async buildUserContent(
    card: ProductCard,
    withPhotos: boolean,
  ): Promise<OpenAI.Chat.ChatCompletionContentPart[]> {
    const characteristics = (card.characteristics ?? [])
      .map((c) => `${c.key}: ${c.value}`)
      .join('; ');

    const category = await this.categories.describeForCheck(card.categoryId);

    const keys = photoKeys(card);
    const attached: string[] = [];
    if (withPhotos) {
      for (const key of keys) {
        try {
          attached.push(await this.files.toDataUrl(key));
        } catch (err) {
          this.logger.warn(
            `Фото ${key} не прочитано из S3: ${errorMessage(err)}`,
          );
        }
      }
    }
    if (withPhotos && keys.length > 0 && attached.length === 0) {
      throw new PhotosUnavailableError(
        'не удалось прочитать ни одной фотографии из хранилища',
      );
    }

    const text = [
      `Название: ${card.name}`,
      `Категория: ${category?.label ?? '(не выбрана)'}`,
      ...(category?.isService
        ? [
            'Это карточка услуги — продаётся работа, а не вещь. ' +
              'Услуги на площадке разрешены: проверяй её по правилам для услуг.',
          ]
        : []),
      `Цена: ${card.price ?? 'договорная'}`,
      `Состояние: ${card.state === 'new' ? 'новый' : 'б/у'}`,
      `Описание: ${card.description ?? '(пусто)'}`,
      `Характеристики: ${characteristics || '(нет)'}`,
      photoNote(keys.length, attached.length),
      `Аспекты для checks: ${AI_ASPECTS.join(', ')}`,
    ].join('\n');

    const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text },
    ];
    for (const url of attached) {
      parts.push({ type: 'image_url', image_url: { url } });
    }

    return parts;
  }
}

class PhotosUnavailableError extends Error {}

function photoKeys(card: ProductCard): string[] {
  return (card.photos ?? []).slice(0, MAX_PHOTOS);
}

function photoNote(total: number, attached: number): string {
  if (attached > 0) return `Фотографии: приложено ${attached} шт.`;
  if (total === 0) return 'Фотографии: продавец не загрузил ни одной';
  return (
    `Фотографии: продавец загрузил ${total} шт., но скачать их не удалось — ` +
    'это наш технический сбой, а не нарушение. По аспектам photos и photoMatch ' +
    'верни warn с notes «фото недоступны для проверки» и не снижай из-за них ' +
    'итоговый вердикт.'
  );
}

export function obviousContentViolation(card: ProductCard): string | null {
  const name = card.name.trim().toLowerCase();
  const compact = name.replace(/[\s._-]+/g, '');
  if (!/[\p{L}\p{N}]/u.test(name))
    return 'Название не содержит названия товара';
  if (
    /^(?:test|тест|demo|пример|asdf|sdf|qwerty|zxcv|йцук|фыва|ячсм)\d*$/u.test(
      compact,
    )
  ) {
    return 'Название похоже на тестовую заглушку или случайный набор символов';
  }
  if (/^(?:sdf|asd|qwe|zxc|йцу|фыв|ячс){2,}$/u.test(compact)) {
    return 'Название состоит из повторяющегося случайного набора символов';
  }
  return null;
}

function aiFailureText(
  card: ProductCard,
  reason: string,
  details: string | null | undefined,
): string {
  const name = escapeHtml(card.name);
  const tail = details ? `\n\n${escapeHtml(excerpt(details, 500))}` : '';
  return (
    `🤖 <b>ИИ-проверка</b>: ${reason}\n` +
    `Товар #${card.id} — ${name}${tail}\n\n` +
    `Разобрать: раздел «Проверка ИИ» в админке.`
  );
}
