import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
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

/**
 * Порог «застревания» на проверке. Заметно больше таймаута запроса вместе с
 * ретраем — иначе при старте второго инстанса подхватились бы карточки,
 * которые прямо сейчас проверяет первый.
 */
const STUCK_PENDING_MINUTES = 15;
const STUCK_PENDING_LIMIT = 100;
/**
 * Одно фото, а не вся галерея: картинка стоит около 2400 токенов, и четыре
 * из них удорожали бы каждую проверку вчетверо без заметной пользы.
 */
const MAX_PHOTOS = 1;

/** 429 по лимиту — штатная ситуация, SDK разведёт повторы по экспоненте. */
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
  место мастера, пример «до и после», оформленное объявление с текстом услуги.
  Требовать фотографию продаваемой вещи здесь нечего. fail — только за мусор:
  скриншоты переписки и кода, мемы, чужую рекламу, пустые изображения;
- photoMatch — довольно того, что фотография не противоречит описанной услуге.
  Отсутствие на снимке «того самого товара» нарушением не считается;
- состояние «новый»/«б/у» к услуге не относится — это не рассогласование данных;
- отсутствие характеристик у услуги нормально: там описывают работу словами.

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

  /**
   * Товар не публикуется, пока проверка не завершилась, поэтому упавший процесс
   * оставил бы карточку невидимой навсегда: записи проверки нет, в очередь
   * модерации она не попадёт, и продавцу пришлось бы идти к администратору.
   */
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

  /** Последовательно, а не параллельно: очередь после простоя может быть длинной. */
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
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Повтор проверки товара ${card.id} упал: ${message}`);
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
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Модель не ответила по товару ${card.id}: ${message}`);
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
      const applied = await this.repository.recordDecision(
        card,
        decision,
        'hidden',
      );
      if (!applied) return this.logStale(card);
      await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
      this.logger.warn(`Товар ${card.id} скрыт по вердикту ИИ-проверки`);
      void this.notifications.notifyAdmins(
        aiFailureText(card, 'модель забраковала товар', result.summary),
      );
      return;
    }

    const applied = await this.repository.recordDecision(
      card,
      decision,
      'active',
    );
    if (!applied) return this.logStale(card);
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
    this.logger.log(`Товар ${card.id} опубликован — вердикт ${result.verdict}`);
  }

  /**
   * Запрос к модели с фотографиями, а при неудачной загрузке — повтор по одному
   * тексту. Фото лежат в публичном S3, и скачивает их сама модель: её таймаут на
   * нашей картинке не должен превращаться в непройденную проверку.
   */
  private async complete(
    model: string,
    card: ProductCard,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    return this.request(model, card, true);
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

  private async deferToManualReview(
    card: ProductCard,
    model: string,
    summary: string,
    error: string,
  ): Promise<void> {
    const applied = await this.repository.recordDecision(card, {
      verdict: 'warn',
      checks: {},
      summary,
      model,
      error,
    });
    if (!applied) return this.logStale(card);
    this.logger.warn(`Товар ${card.id} не опубликован: ${summary}`);
    void this.notifications.notifyAdmins(
      aiFailureText(card, 'требуется ручная проверка', `${summary}: ${error}`),
    );
  }

  private async reject(
    card: ProductCard,
    model: string,
    reason: string,
  ): Promise<void> {
    const applied = await this.repository.recordDecision(
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
    );
    if (!applied) return this.logStale(card);
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
    this.logger.warn(`Товар ${card.id} отклонён до ИИ-проверки: ${reason}`);
    void this.notifications.notifyAdmins(
      aiFailureText(card, 'карточка забракована', reason),
    );
  }

  private logStale(card: ProductCard): void {
    this.logger.log(
      `Результат проверки товара ${card.id} отброшен: карточка уже изменилась`,
    );
  }

  /**
   * Фото отдаём байтами в data-URL, а не ссылкой на S3. По ссылке за картинкой
   * ходила бы сама модель, и любая заминка на нашей стороне — опечатка в
   * домене, медленная раздача, приватный бакет — возвращалась как «Timeout
   * while downloading», то есть проверка срывалась из-за чужого сбоя.
   *
   * Если байты прочитать не удалось, проверяем только текст, но говорим об этом
   * модели прямо: иначе она сочтёт, что фото нет вовсе, и забракует карточку.
   */
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
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Фото ${key} не прочитано из S3: ${message}`);
        }
      }
    }
    if (withPhotos && keys.length > 0 && attached.length === 0) {
      throw new Error('Не удалось загрузить фотографию товара для проверки');
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

function photoKeys(card: ProductCard): string[] {
  return (card.photos ?? []).slice(0, MAX_PHOTOS);
}

/**
 * Разводит два случая, которые модель иначе не различит: фото нет у товара —
 * это к продавцу, фото есть, но не дошли до модели — это к нам.
 */
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

/**
 * Текст для админского чата о товаре, который требует ручного разбора.
 * Ссылку на раздел, а не на карточку: очередь всё равно открывается целиком.
 */
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
