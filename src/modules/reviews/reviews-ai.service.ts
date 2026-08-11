import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
import type { AiVerdict } from '../ai/ai-check.types';

/** Отзыв — это несколько строк текста, дольше минуты модели тут делать нечего. */
const REQUEST_TIMEOUT_MS = 45_000;

/** 429 по лимиту — штатная ситуация, SDK разведёт повторы по экспоненте. */
const MAX_RETRIES = 2;

/** Причину видит автор отзыва, и простыня в уведомлении ему не нужна. */
const MAX_NOTE_LENGTH = 300;

const SYSTEM_PROMPT = `Ты модератор отзывов на маркетплейсе компьютерной техники. Тебе дают отзыв покупателя. Верни строго JSON без пояснений:
{"verdict":"pass|warn|fail","note":"одно предложение по-русски"}

fail — отзыв публиковать нельзя:
- мат, оскорбления, угрозы, разжигание вражды;
- реклама и спам: телефоны, ссылки, приглашения в другие магазины и каналы;
- чужие персональные данные: адрес, номер, паспорт, имя постороннего человека;
- бессмысленный набор символов вместо текста;
- текст, не имеющий отношения ни к товару, ни к продавцу.

warn — публиковать можно, но человеку стоит взглянуть:
- обвинения в мошенничестве и обмане без подробностей;
- жалоба на что-то, не зависящее от продавца, поданная как его вина;
- оценка резко расходится с текстом (пять звёзд при описании поломки).

pass — обычный отзыв, даже очень резкий и очень короткий.

Правила, которые важнее вежливости:
- негативный отзыв — не нарушение. «Не советую», «продавец нахамил», «товар сломался через неделю» — это pass. Покупатель вправе быть недоволен, и вычищать критику — прямой вред площадке;
- орфография, регистр и краткость не влияют на вердикт: «норм» — это pass;
- отзыв без текста, с одной только оценкой, — pass.

note: при fail и warn — почему, одним предложением, спокойно и по делу: этот текст автор увидит как причину отказа. При pass — пустая строка.`;

export interface ReviewAiResult {
  verdict: AiVerdict;
  note: string;
}

/** Что показать модели: сам отзыв и то, о чём он. */
export interface ReviewForCheck {
  rating: number;
  text: string | null;
  productName: string | null;
  shopName: string;
}

/**
 * ИИ-модерация отзывов.
 *
 * Отдельный сервис, а не часть проверки товаров: там вердикт решает судьбу
 * карточки продавца и смотрит на фотографии, здесь — короткий текст покупателя
 * и совсем другие правила. Общее у них только имя вердиктов.
 */
@Injectable()
export class ReviewsAiService {
  private readonly logger = new Logger(ReviewsAiService.name);

  constructor(
    @Inject(OPENROUTER_CLIENT) private readonly ai: OpenAI | null,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.ai !== null;
  }

  /**
   * `null` — проверка не состоялась: ключа нет или модель не ответила. Отзыв в
   * этом случае остаётся человеку. Молча публиковать непроверенное нельзя, а
   * молча отклонять — тем более.
   */
  async check(review: ReviewForCheck): Promise<ReviewAiResult | null> {
    if (!this.ai) return null;

    const model = this.config.get<string>('openrouter.model')!;

    try {
      const completion = await this.ai.chat.completions.create(
        {
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: describe(review) },
          ],
        },
        { timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES },
      );

      return parseResult(completion.choices[0]?.message?.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Модель не ответила по отзыву (${model}): ${message}`);
      return null;
    }
  }
}

function describe(review: ReviewForCheck): string {
  return [
    review.productName
      ? `Отзыв о товаре «${review.productName}» в магазине «${review.shopName}»`
      : `Отзыв о магазине «${review.shopName}»`,
    `Оценка: ${review.rating} из 5`,
    `Текст: ${review.text?.trim() || '(без текста)'}`,
  ].join('\n');
}

/**
 * Разбор ответа. Форме доверять нельзя: что не распозналось — становится
 * `warn`, то есть уходит человеку. Ошибка разбора не должна ни публиковать
 * отзыв, ни отклонять его от имени модели.
 */
function parseResult(raw: string | null | undefined): ReviewAiResult {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    return { verdict: 'warn', note: 'Не удалось разобрать ответ модели' };
  }

  const verdict = parsed.verdict;
  const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';

  return {
    verdict:
      verdict === 'pass' || verdict === 'fail' || verdict === 'warn'
        ? verdict
        : 'warn',
    note: note.slice(0, MAX_NOTE_LENGTH),
  };
}
