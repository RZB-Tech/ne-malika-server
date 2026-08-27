import { createHash } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { RedisService } from '../redis/redis.service';
import type { ApiLocale } from '../../common/i18n/locale';
import { errorMessage } from '../../common/errors';
import { parseAiCompare, type ComparedProduct } from './ai-compare.parse';
import {
  AI_COMPARE_MAX,
  AI_COMPARE_MIN,
  AiCompareResultDto,
} from './dto/ai-compare.dto';

type PublicCard = Awaited<
  ReturnType<ProductCardsRepository['findPublicList']>
>['data'][number];

const REQUEST_TIMEOUT_MS = 60_000;

const MAX_RETRIES = 1;

const MAX_COMPLETION_TOKENS = 1200;

const TEMPERATURE = 0.2;

const DESCRIPTION_MAX = 700;
const CHARACTERISTICS_MAX = 24;

const CACHE_PREFIX = 'aicmp:';

const CACHE_TTL_SEC = 24 * 60 * 60;

const SYSTEM_PROMPT = `Ты помогаешь покупателю выбрать компьютерную технику на маркетплейсе. Тебе дают от двух до четырёх товаров: название, цену, состояние, характеристики и описание продавца.

Разложи товары по составляющим — процессор, видеокарта, оперативная память, накопитель, экран, аккумулятор, разъёмы и интерфейсы, блок питания, материнская плата, охлаждение, корпус и форм-фактор, вес, тип подключения — и сравни их построчно.

Верни строго JSON без пояснений:
{"comparable":true,
 "summary":"2-3 предложения",
 "rows":[{"component":"Процессор","values":["Ryzen 5 5600","Core i5-11400F"],"best":0,"note":"больше потоков"}],
 "products":[{"index":0,"pros":["..."],"cons":["..."],"bestFor":"..."}],
 "verdict":{"best":0,"value":1,"text":"..."}}

Таблица rows:
- values — по одному значению на каждый товар, строго в том порядке, в каком товары даны. Нечего сказать о составляющей — "—";
- строку добавляй, только если хотя бы у одного товара значение есть. Строк не больше двенадцати;
- best — индекс товара с лучшим значением (0 — первый). Ничья или сравнивать нечего — null;
- note — чем именно лучше, одним коротким предложением. Нечего добавить — пустая строка;
- цену в rows не выноси: она и так на виду в обычной таблице. Цена нужна только в verdict.

Честность важнее полноты:
- бери только то, что есть в карточке. Не додумывай ни объём памяти, ни год выпуска, ни гарантию, ни комплектацию: приписанная характеристика — это обещание, которого продавец не давал;
- если модель составляющей названа точно (Ryzen 5 5600, RTX 4060, DDR4-3200), опираться на её общеизвестные свойства можно: это свойство самой детали, а не слова продавца;
- «б/у» — не порок сам по себе, но если рядом стоит новый товар, упомяни это в минусах;
- сравнивай железо, а не красоту описания: длинный текст ничего не говорит о товаре;
- никаких ссылок, телефонов, названий других площадок и призывов писать продавцу.

comparable: false — когда это разная по назначению техника (ноутбук и мышь) и построчное сравнение железа бессмысленно. Тогда rows оставь пустым, а в summary объясни, что товары решают разные задачи.

verdict: best — у кого железо сильнее; value — что выгоднее за свои деньги с учётом цены и состояния; товар с договорной ценой в value не бери. text — 2-3 предложения о том, кому какой брать.

Пиши коротко и по делу, без вступлений, без эмодзи и рекламных восклицаний.`;

const LANGUAGE_HINT: Record<ApiLocale, string> = {
  ru: 'Отвечай по-русски.',
  'uz-Latn': 'Javobni o‘zbek tilida, lotin yozuvida yoz (не по-русски).',
  'uz-Cyrl': 'Жавобни ўзбек тилида, кирилл ёзувида ёз (не по-русски).',
};

@Injectable()
export class AiCompareService {
  private readonly logger = new Logger(AiCompareService.name);

  constructor(
    @Inject(OPENROUTER_CLIENT) private readonly ai: OpenAI | null,
    private readonly cards: ProductCardsRepository,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async compare(ids: number[], locale: ApiLocale): Promise<AiCompareResultDto> {
    if (!this.ai) {
      throw new ServiceUnavailableException('ИИ-сравнение сейчас недоступно');
    }

    const cards = await this.load(ids);
    if (cards.length < AI_COMPARE_MIN) {
      throw new BadRequestException(
        'Нужно хотя бы два доступных товара: часть выбранного уже не продаётся',
      );
    }

    const model = this.config.get<string>('openrouter.compareModel')!;
    const key = cacheKey(cards, locale, model);

    const cached = await this.redis.get<AiCompareResultDto>(key);
    if (cached) return { ...cached, cached: true };

    const result = await this.ask(cards, locale, model);
    await this.redis.set(key, result, CACHE_TTL_SEC);
    return { ...result, cached: false };
  }

  private async load(ids: number[]): Promise<PublicCard[]> {
    const { data } = await this.cards.findPublicList({
      ids,
      limit: AI_COMPARE_MAX,
    });
    const byId = new Map(data.map((card) => [card.id, card]));
    return ids
      .map((id) => byId.get(id))
      .filter((card): card is PublicCard => card !== undefined);
  }

  private async ask(
    cards: PublicCard[],
    locale: ApiLocale,
    model: string,
  ): Promise<AiCompareResultDto> {
    const products: ComparedProduct[] = cards.map((card) => ({
      id: card.id,
      name: card.name,
    }));

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await this.ai!.chat.completions.create(
        {
          model,
          response_format: { type: 'json_object' },
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          temperature: TEMPERATURE,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `${LANGUAGE_HINT[locale]}\n\n${cards.map(describe).join('\n\n')}`,
            },
          ],
        },
        { timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES },
      );
    } catch (err) {
      this.logger.error(
        `Сравнение товаров ${products.map((p) => p.id).join(',')} не удалось (${model}): ${errorMessage(err)}`,
      );
      throw new BadGatewayException('Модель не ответила — попробуйте позже');
    }

    const result = parseAiCompare(
      completion.choices[0]?.message?.content,
      products,
    );
    if (!result) {
      this.logger.error(
        `Модель вернула неразбираемый ответ по товарам ${products
          .map((p) => p.id)
          .join(',')} (${model}, finish_reason: ${
          completion.choices[0]?.finish_reason ?? '—'
        })`,
      );
      throw new BadGatewayException(
        'Модель ответила невнятно — попробуйте ещё раз',
      );
    }

    return result;
  }
}

function describe(card: PublicCard, index: number): string {
  const characteristics = (card.characteristics ?? [])
    .slice(0, CHARACTERISTICS_MAX)
    .map((c) => `${c.key}: ${c.value}`)
    .join('; ');

  return [
    `Товар ${index + 1}`,
    `Название: ${card.name}`,
    `Цена: ${card.price ? `${trimPrice(card.price)} сум` : 'договорная'}`,
    `Состояние: ${card.state === 'new' ? 'новый' : 'б/у'}`,
    `Характеристики: ${characteristics || '(продавец не заполнил)'}`,
    `Описание: ${clip(card.description, DESCRIPTION_MAX) || '(пусто)'}`,
  ].join('\n');
}

function trimPrice(price: string): string {
  const value = Number(price);
  return Number.isFinite(value) ? String(value) : price;
}

function clip(text: string | null, max: number): string {
  const value = (text ?? '').trim().replace(/\s+/g, ' ');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function cacheKey(
  cards: PublicCard[],
  locale: ApiLocale,
  model: string,
): string {
  const fingerprint = cards
    .map((card) =>
      [
        card.id,
        card.name,
        card.price ?? '',
        card.state,
        card.description ?? '',
        (card.characteristics ?? [])
          .map((c) => `${c.key}=${c.value}`)
          .join('|'),
      ].join(''),
    )
    .join('');

  const hash = createHash('sha1')
    .update(`${model}${locale}${fingerprint}`)
    .digest('hex')
    .slice(0, 24);

  return `${CACHE_PREFIX}${hash}`;
}
