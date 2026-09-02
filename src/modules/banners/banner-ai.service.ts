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
import { estimateImagesUsd } from '../credits/credits.constants';
import { effectiveLimits } from '../subscriptions/subscriptions.constants';
import { errorMessage } from '../../common/errors';
import type { Shop } from '../../db/schema';
import {
  BANNER_GEN_QUALITY,
  BANNER_GEN_SIZE,
  BANNER_SOURCE_PRODUCTS,
} from './banners.constants';
import { toBannerFormat } from './banner-image';
import {
  buildBannerPrompt,
  buildTranslationPrompt,
  type BannerLanguage,
  type BannerProduct,
} from './banner-prompt';
import {
  GenerateBannerDto,
  TranslateBannerDto,
  type BannerAiPriceDto,
  type GeneratedBannerDto,
} from './dto/generate-banner.dto';

/** Баннер большой, а модель рисует его целиком — три минуты берём с запасом. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Один повтор: продавец смотрит на спиннер и второй заход ждать не станет. */
const MAX_RETRIES = 1;

const PLAN_REQUIRED = 'Генерация баннера доступна на тарифе MAX';

/**
 * Сколько картинок в запросе. Одна: продавец принимает или перегенерирует, а
 * не выбирает из сетки — так и цена кнопки понятна заранее, и следующим шагом
 * идёт перевод именно принятой картинки.
 */
const IMAGES_PER_REQUEST = 1;

/**
 * Генерация баннера магазина по его же товарам.
 *
 * Работает в два шага и намеренно не в один. Сначала рисуется русская версия:
 * продавец смотрит на неё и либо перегенерирует, либо принимает. Только принятая
 * картинка уходит во второй шаг — узбекскую версию, которая рисуется поверх неё
 * и меняет одни надписи. Иначе два языка разъезжались бы по вёрстке и товарам, и
 * на витрине это выглядело бы как два разных баннера у одного магазина.
 *
 * Обе картинки платные и списываются с кредитов магазина: за баннер платит
 * продавец, а не площадка.
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
  async price(ownerId: number): Promise<BannerAiPriceDto> {
    const shop = await this.shops.getActiveOwnShopOrThrow(ownerId);
    const price = await this.credits.estimateCredits(this.estimateUsd());

    if (effectiveLimits(shop).bannerSlots <= 0) {
      return { price, allowed: false, balance: null };
    }

    const balance = await this.credits.available(shop.id);
    return { price, allowed: balance >= price, balance };
  }

  /** Первый шаг: русский баннер по названию магазина и его товарам. */
  async generateRu(
    ownerId: number,
    dto: GenerateBannerDto,
  ): Promise<GeneratedBannerDto> {
    const shop = await this.assertMayGenerate(ownerId);

    const products = await this.loadProducts(shop.id, dto.productIds);
    const references = await this.readPhotos(
      products.map((product) => product.photo),
    );

    const prompt = buildBannerPrompt({
      shop: { name: shop.name, description: shop.description },
      products,
      language: 'ru',
      hasPhotos: references.length > 0,
      accent: dto.accent,
    });

    return this.render(ownerId, shop, prompt, references, 'ru');
  }

  /**
   * Второй шаг: та же картинка на узбекском.
   *
   * Оригинал уходит единственным референсом — модель обязана повторить вёрстку,
   * а не нарисовать «ещё один баннер про то же самое».
   */
  async generateUz(
    ownerId: number,
    dto: TranslateBannerDto,
  ): Promise<GeneratedBannerDto> {
    const shop = await this.assertMayGenerate(ownerId);

    if (!(await this.files.exists(dto.photoKey))) {
      throw new BadRequestException(
        'Русский баннер не найден — сначала сгенерируйте его',
      );
    }

    const references = await this.readPhotos([dto.photoKey]);
    if (references.length === 0) {
      throw new BadGatewayException(
        'Не удалось прочитать русский баннер из хранилища',
      );
    }

    const prompt = buildTranslationPrompt({
      shop: { name: shop.name },
      language: 'uz-Latn',
    });

    return this.render(ownerId, shop, prompt, references, 'uz-Latn');
  }

  /**
   * Общая часть обоих шагов: занять кредиты, сходить к модели, привести
   * картинку к формату баннера и списать.
   *
   * Порядок с деньгами тот же, что и в остальных платных операциях: списание
   * стоит после того, как картинка сохранена. `settle` и `cancel` — на
   * взаимоисключающих путях: списание уже сняло резерв, и повторный `cancel`
   * освободил бы сверх него чужой, занятый соседним запросом магазина.
   */
  private async render(
    ownerId: number,
    shop: Shop,
    prompt: string,
    references: ImageReference[],
    language: BannerLanguage,
  ): Promise<GeneratedBannerDto> {
    const model = this.config.get<string>('openrouter.imageModel')!;
    const hold = await this.credits.hold(
      { id: ownerId, isAdmin: false },
      this.estimateUsd(references.length),
      'генерацию баннера',
    );

    let saved: { key: string; url: string };
    let usd: number | undefined;
    try {
      const result = await this.request(model, prompt, references);
      usd = usageCost(result.usage);

      const image = result.data?.find((item) => item.b64_json)?.b64_json;
      if (!image) {
        throw new Error('модель не вернула картинку');
      }

      saved = await this.save(image);
    } catch (err) {
      await this.credits.cancel(hold);

      const details = describeError(err);
      this.logger.error(
        `Баннер магазина ${shop.id} (${language}) не сгенерирован (${model}): ${details}`,
      );
      throw new BadGatewayException(
        (err as { status?: number }).status === 429
          ? `Лимит запросов исчерпан. ${details}`
          : `Не удалось нарисовать баннер: ${details}`,
      );
    }

    const spent = await this.settleAndLog(hold, ownerId, usd, model);

    this.logger.log(
      `Баннер магазина ${shop.id} (${language}) готов: ${saved.key}, списано ${spent}`,
    );

    return {
      ...saved,
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
      timeout: REQUEST_TIMEOUT_MS,
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
   * нажали кнопку.
   */
  private async settleAndLog(
    hold: CreditHold | null,
    ownerId: number,
    usd: number | undefined,
    model: string,
  ): Promise<number> {
    const credits = await this.credits.settle(hold, usd, {
      operation: 'banner',
      model,
      images: IMAGES_PER_REQUEST,
    });

    await this.aiUsage.record({
      userId: ownerId,
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
   * Себестоимость запроса. Считается по прайсу модели с учётом размера и числа
   * приложенных картинок — тем же способом, что и у генерации фото товара.
   */
  private estimateUsd(references = BANNER_SOURCE_PRODUCTS): number {
    return estimateImagesUsd(
      BANNER_GEN_SIZE,
      BANNER_GEN_QUALITY,
      IMAGES_PER_REQUEST,
      references,
    );
  }

  private async assertMayGenerate(ownerId: number): Promise<Shop> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — баннер придётся нарисовать вручную',
      );
    }

    const shop = await this.shops.getActiveOwnShopOrThrow(ownerId);
    if (effectiveLimits(shop).bannerSlots <= 0) {
      throw new ForbiddenException(PLAN_REQUIRED);
    }
    return shop;
  }

  /**
   * Товары для баннера. Продавец может выбрать их сам; без выбора берём
   * последние опубликованные — витрина магазина и так показывает их первыми.
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
