import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
import { describeError, usageCost } from '../openrouter/openrouter.util';
import type {
  ImageReference,
  OpenRouterImagesResponse,
} from '../openrouter/openrouter.images';
import { FilesService } from '../files/files.service';
import { ShopsService } from '../shops/shops.service';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { CreditsService, type CreditHold } from '../credits/credits.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import {
  estimateImagesUsd,
  estimatePromptUsd,
} from '../credits/credits.constants';
import { effectiveLimits } from '../subscriptions/subscriptions.constants';
import { errorMessage } from '../../common/errors';
import type { Shop } from '../../db/schema';
import {
  BANNER_GEN_QUALITY,
  BANNER_GEN_SIZE,
  BANNER_SOURCE_PRODUCTS,
  shopBannerLink,
} from './banners.constants';
import { toBannerFormat } from './banner-image';
import {
  BANNER_BRIEF_SYSTEM,
  buildShopBrief,
  buildTranslationPrompt,
  composeBannerPrompt,
  fallbackBrief,
  parseBannerBrief,
  type BannerBrief,
  type BannerLanguage,
  type BannerProduct,
} from './banner-prompt';
import type {
  BannerAiPriceDto,
  GeneratedBannerDto,
} from './dto/generate-banner.dto';

/** Баннер большой, а модель рисует его целиком — три минуты берём с запасом. */
const IMAGE_TIMEOUT_MS = 180_000;

/** Разбор магазина — короткий текстовый запрос, минуты хватает с избытком. */
const BRIEF_TIMEOUT_MS = 60_000;

/** Один повтор: продавец смотрит на спиннер и второй заход ждать не станет. */
const MAX_RETRIES = 1;

/** Замысел укладывается в сотню слов; потолок нужен, чтобы не платить за эссе. */
const BRIEF_MAX_TOKENS = 600;

const PLAN_REQUIRED = 'Генерация баннера доступна на тарифе MAX';

/**
 * Сколько картинок в запросе. Одна: продавец принимает или перерисовывает, а
 * не выбирает из сетки — так и цена кнопки понятна заранее, и следующим шагом
 * идёт перевод именно принятой картинки.
 */
const IMAGES_PER_REQUEST = 1;

/** Кто просит баннер. У администратора списания нет — платит площадка. */
export interface BannerAuthor {
  id: number;
  isAdmin: boolean;
  /** Магазин, для которого рисуем. Продавцу подставляется его собственный. */
  shopId?: number;
}

/**
 * Генерация баннера магазина.
 *
 * Два шага и намеренно не один. Сначала русская версия: продавец смотрит на неё
 * и либо перерисовывает, либо принимает. Только принятая картинка уходит во
 * второй шаг — узбекскую версию, которая рисуется поверх неё и меняет одни
 * надписи. Иначе два языка разъезжались бы по вёрстке и товарам, и на витрине
 * это выглядело бы как два разных баннера у одного магазина.
 *
 * Внутри первого шага тоже две модели. Дешёвая разбирает магазин и пишет
 * задание — что рисовать этому конкретному продавцу; рисующая по этому заданию
 * делает картинку. Собранный в коде шаблон так не умеет: у магазина ноутбуков и
 * у мастерской по ремонту он давал один и тот же баннер с подставленным именем.
 *
 * Вводить продавцу нечего: название баннера придумывает та же модель, ссылка
 * ведёт на страницу магазина.
 */
@Injectable()
export class BannerAiService {
  private readonly logger = new Logger(BannerAiService.name);

  constructor(
    @Inject(OPENROUTER_CLIENT) private readonly router: OpenAI | null,
    private readonly files: FilesService,
    private readonly shops: ShopsService,
    private readonly products: ProductCardsRepository,
    private readonly credits: CreditsService,
    private readonly aiUsage: AiUsageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Цена и остаток — форма спрашивает их до нажатия кнопки, чтобы показать
   * стоимость рядом с ней, а не выдавать отказ уже после клика.
   */
  async price(author: BannerAuthor): Promise<BannerAiPriceDto> {
    const price = await this.credits.estimateCredits(this.estimateUsd());
    if (author.isAdmin) return { price, allowed: true, balance: null };

    const shop = await this.resolveShop(author);
    if (effectiveLimits(shop).bannerSlots <= 0) {
      return { price, allowed: false, balance: null };
    }

    const balance = await this.credits.available(shop.id);
    return { price, allowed: balance >= price, balance };
  }

  /** Первый шаг: разобрать магазин и нарисовать русский баннер. */
  async generateRu(
    author: BannerAuthor,
    productIds: number[] | undefined,
  ): Promise<GeneratedBannerDto> {
    const shop = await this.assertMayGenerate(author);

    const products = await this.loadProducts(shop.id, productIds);
    const references = await this.readPhotos(
      products.map((product) => product.photo),
    );

    const { brief, usd } = await this.describeShop(shop, products, references);

    return this.render({
      author,
      shop,
      prompt: composeBannerPrompt(brief.prompt, 'ru'),
      references,
      language: 'ru',
      title: brief.title || null,
      spentUsd: usd,
    });
  }

  /**
   * Второй шаг: та же картинка на узбекском.
   *
   * Оригинал уходит единственным референсом — модель обязана повторить вёрстку,
   * а не нарисовать «ещё один баннер про то же самое». Магазин заново не
   * разбираем: замысел уже принят вместе с картинкой.
   */
  async generateUz(
    author: BannerAuthor,
    photoKey: string,
  ): Promise<GeneratedBannerDto> {
    const shop = await this.assertMayGenerate(author);

    if (!(await this.files.exists(photoKey))) {
      throw new BadRequestException(
        'Русский баннер не найден — сначала сгенерируйте его',
      );
    }

    const references = await this.readPhotos([photoKey]);
    if (references.length === 0) {
      throw new BadGatewayException(
        'Не удалось прочитать русский баннер из хранилища',
      );
    }

    return this.render({
      author,
      shop,
      prompt: buildTranslationPrompt({ shop, language: 'uz-Latn' }),
      references,
      language: 'uz-Latn',
      title: null,
    });
  }

  /**
   * Разбор магазина дешёвой моделью: что за продавец и что ему рисовать.
   *
   * Ошибка здесь генерацию не срывает — берём запасной замысел, собранный по
   * названию и разделам. Баннер выйдет безликим, но продавец увидит картинку, а
   * не отказ из-за того, что вспомогательная модель не ответила.
   */
  private async describeShop(
    shop: Shop,
    products: (BannerProduct & { photo: string | undefined })[],
    references: ImageReference[],
  ): Promise<{ brief: BannerBrief; usd: number | undefined }> {
    const fallback = fallbackBrief({
      shop,
      products,
      hasPhotos: references.length > 0,
    });

    const model = this.config.get<string>('openrouter.visionModel')!;
    const brief = buildShopBrief({
      shop,
      products,
      hasPhotos: references.length > 0,
    });

    try {
      const completion = await this.router!.chat.completions.create(
        {
          model,
          max_completion_tokens: BRIEF_MAX_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: BANNER_BRIEF_SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: brief },
                ...references.map((reference) => ({
                  type: 'image_url' as const,
                  image_url: {
                    url: reference.image_url.url,
                    detail: 'low' as const,
                  },
                })),
              ],
            },
          ],
        },
        { timeout: BRIEF_TIMEOUT_MS, maxRetries: MAX_RETRIES },
      );

      const parsed = parseBannerBrief(completion.choices[0]?.message?.content);
      if (!parsed) {
        this.logger.warn(
          `Магазин ${shop.id}: разбор не удался, берём запасной замысел`,
        );
        return { brief: fallback, usd: usageCost(completion.usage) };
      }

      return {
        brief: { prompt: parsed.prompt, title: parsed.title || fallback.title },
        usd: usageCost(completion.usage),
      };
    } catch (err) {
      this.logger.warn(
        `Магазин ${shop.id} не разобран (${model}): ${describeError(err)}`,
      );
      return { brief: fallback, usd: undefined };
    }
  }

  /**
   * Общая часть обоих шагов: занять кредиты, сходить к рисующей модели,
   * привести картинку к формату баннера и списать.
   *
   * Порядок с деньгами тот же, что и в остальных платных операциях: списание
   * стоит после того, как картинка сохранена. `settle` и `cancel` — на
   * взаимоисключающих путях: списание уже сняло резерв, и повторный `cancel`
   * освободил бы сверх него чужой, занятый соседним запросом магазина.
   */
  private async render(input: {
    author: BannerAuthor;
    shop: Shop;
    prompt: string;
    references: ImageReference[];
    language: BannerLanguage;
    title: string | null;
    /** Что уже потрачено на разбор магазина — уходит в тот же счёт. */
    spentUsd?: number;
  }): Promise<GeneratedBannerDto> {
    const { author, shop, prompt, references, language, title } = input;

    const model = this.config.get<string>('openrouter.imageModel')!;
    const hold = await this.credits.hold(
      author,
      this.estimateUsd(references.length),
      'генерацию баннера',
    );

    let saved: { key: string; url: string };
    let usd: number | undefined;
    try {
      const result = await this.request(model, prompt, references);
      usd = sumUsd(input.spentUsd, usageCost(result.usage));

      const image = result.data?.find((item) => item.b64_json)?.b64_json;
      if (!image) {
        throw new Error('модель не вернула картинку');
      }

      saved = await this.save(image);
    } catch (err) {
      await this.credits.cancel(hold);

      const details = describeError(err);
      this.logger.error(
        `Баннер магазина ${shop.id} (${language}) не нарисован (${model}): ${details}`,
      );
      throw new BadGatewayException(
        (err as { status?: number }).status === 429
          ? `Лимит запросов исчерпан. ${details}`
          : `Не удалось нарисовать баннер: ${details}`,
      );
    }

    const spent = await this.settleAndLog(hold, author, usd, model);

    this.logger.log(
      `Баннер магазина ${shop.id} (${language}) готов: ${saved.key}, списано ${spent}`,
    );

    return {
      ...saved,
      title,
      /** Ссылку продавец не вводит: баннер магазина ведёт на сам магазин. */
      linkUrl: shopBannerLink(shop.id),
      balance: hold ? await this.credits.available(hold.shopId) : null,
    };
  }

  private async request(
    model: string,
    prompt: string,
    references: ImageReference[],
  ): Promise<OpenRouterImagesResponse> {
    return this.router!.post<unknown, OpenRouterImagesResponse>('/images', {
      body: {
        model,
        prompt,
        n: IMAGES_PER_REQUEST,
        size: BANNER_GEN_SIZE,
        quality: BANNER_GEN_QUALITY,
        input_references: references,
      },
      timeout: IMAGE_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }

  /** Картинка приводится к формату баннера до сохранения: в S3 кладём готовое. */
  private async save(b64: string): Promise<{ key: string; url: string }> {
    const cropped = await toBannerFormat(Buffer.from(b64, 'base64'));
    const key = await this.files.saveBuffer(cropped, 'image/jpeg');
    return { key, url: this.files.buildPublicUrl(key) };
  }

  /**
   * Списать и записать, кто ходил к модели. Двумя записями, как и в остальных
   * платных операциях: журнал денег ведётся по магазину и не знает, чьи руки
   * нажали кнопку, а запросы администратора списания не создают вовсе.
   */
  private async settleAndLog(
    hold: CreditHold | null,
    author: BannerAuthor,
    usd: number | undefined,
    model: string,
  ): Promise<number> {
    const credits = await this.credits.settle(hold, usd, {
      operation: 'banner',
      model,
      images: IMAGES_PER_REQUEST,
    });

    await this.aiUsage.record({
      userId: author.id,
      shopId: hold?.shopId ?? null,
      operation: 'banner',
      model,
      images: IMAGES_PER_REQUEST,
      usd,
      credits,
    });

    return credits;
  }

  /**
   * Себестоимость запроса: картинка по прайсу модели плюс разбор магазина.
   * Разбор дешёвый, но в резерв входит — иначе на нём копился бы недосписанный
   * расход площадки.
   */
  private estimateUsd(references = BANNER_SOURCE_PRODUCTS): number {
    return (
      estimateImagesUsd(
        BANNER_GEN_SIZE,
        BANNER_GEN_QUALITY,
        IMAGES_PER_REQUEST,
        references,
      ) + estimatePromptUsd()
    );
  }

  private async assertMayGenerate(author: BannerAuthor): Promise<Shop> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — баннер придётся нарисовать вручную',
      );
    }

    const shop = await this.resolveShop(author);

    /** Тариф спрашиваем только у продавца: администратор рисует за площадку. */
    if (!author.isAdmin && effectiveLimits(shop).bannerSlots <= 0) {
      throw new ForbiddenException(PLAN_REQUIRED);
    }
    return shop;
  }

  /**
   * Чей баннер рисуем. Администратор называет магазин сам, продавцу
   * подставляется собственный — чужой id в теле запроса ему не поможет.
   */
  private resolveShop(author: BannerAuthor): Promise<Shop> {
    return author.isAdmin && author.shopId !== undefined
      ? this.shops.getOrThrow(author.shopId)
      : this.shops.getActiveOwnShopOrThrow(author.id);
  }

  /**
   * Товары для баннера. Без выбора берём последние опубликованные — витрина
   * магазина и так показывает их первыми.
   *
   * Скрытые и упразднённые сюда не попадают: выдача публичная, а рекламировать
   * то, что покупатель всё равно не откроет, незачем.
   */
  private async loadProducts(
    shopId: number,
    ids: number[] | undefined,
  ): Promise<(BannerProduct & { photo: string | undefined })[]> {
    const { data } = await this.products.findPublicList({
      shop_id: shopId,
      ids: ids?.length ? ids : undefined,
      limit: BANNER_SOURCE_PRODUCTS,
    });

    return data.map((card) => ({
      name: card.name,
      categoryName: card.categoryNameRu,
      photo: card.photos?.[0],
    }));
  }

  /**
   * Фотографии уходят байтами в data-URL, а не ссылкой на S3, — как и в
   * ИИ-проверке: по ссылке за картинкой ходила бы сама модель, и заминка на
   * нашей стороне возвращалась бы как «Timeout while downloading».
   *
   * Непрочитанное пропускаем: баннер можно нарисовать и по названиям товаров,
   * а срывать генерацию из-за одной недоступной картинки не за что.
   */
  private async readPhotos(
    keys: (string | undefined)[],
  ): Promise<ImageReference[]> {
    const references: ImageReference[] = [];

    for (const key of keys) {
      if (!key) continue;
      try {
        references.push({
          type: 'image_url',
          image_url: { url: await this.files.toDataUrl(key) },
        });
      } catch (err) {
        this.logger.warn(
          `Фото ${key} не прочитано из S3: ${errorMessage(err)}`,
        );
      }
    }

    return references;
  }
}

/**
 * Складывает расход двух моделей в один счёт. `undefined` — стоимость не
 * пришла: смешивать её с нулём нельзя, иначе списание по факту оказалось бы
 * заниженным на непришедшую часть, и разницу оплатила бы площадка.
 */
function sumUsd(
  brief: number | undefined,
  image: number | undefined,
): number | undefined {
  if (brief === undefined && image === undefined) return undefined;
  if (brief === undefined || image === undefined) return undefined;
  return brief + image;
}
