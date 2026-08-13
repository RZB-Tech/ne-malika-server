import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductCardsRepository } from './product-cards.repository';
import { ShopsService } from '../shops/shops.service';
import { AiChecksService } from '../ai/ai-checks.service';
import { CategoriesService } from '../categories/categories.service';
import { RedisService } from '../redis/redis.service';
import { CreateProductCardDto } from './dto/create-product-card.dto';
import { UpdateProductCardDto } from './dto/update-product-card.dto';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';
import { FindAdminProductCardsQueryDto } from './dto/find-admin-product-cards-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import {
  PRODUCT_CACHE_PREFIX,
  PRODUCT_ITEM_TTL_SEC,
  PRODUCT_LIST_TTL_SEC,
  productItemKey,
  productListKey,
} from './product-cards.cache';

type PublicList = Awaited<ReturnType<ProductCardsRepository['findPublicList']>>;
type PublicItem = Awaited<ReturnType<ProductCardsRepository['findPublicById']>>;

/**
 * Цена для записи в столбец. Три состояния, и все три разные:
 * `undefined` — поля в запросе не было, значение трогать нельзя;
 * `null` — продавец выбрал «договорную», цену надо стереть;
 * число — обычная цена, numeric в drizzle принимает строкой.
 */
function priceColumn(
  price: number | null | undefined,
): string | null | undefined {
  if (price === undefined) return undefined;
  return price === null ? null : price.toString();
}

@Injectable()
export class ProductCardsService {
  constructor(
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly shopsService: ShopsService,
    private readonly aiChecksService: AiChecksService,
    private readonly categoriesService: CategoriesService,
    private readonly redis: RedisService,
  ) {}

  async createForSeller(
    ownerId: number,
    shopId: number,
    dto: CreateProductCardDto,
  ) {
    const shop = await this.shopsService.assertOwnership(ownerId, shopId);
    this.shopsService.assertAcceptsProducts(shop);
    await this.categoriesService.assertUsable(
      dto.categoryId,
      shop.restrictedCategoriesEnabled,
    );

    const card = await this.productCardsRepository.create({
      shopId,
      categoryId: dto.categoryId,
      name: dto.name,
      description: dto.description,
      photos: dto.photos,
      price: priceColumn(dto.price) ?? null,
      state: dto.state,
      characteristics: dto.characteristics,
      status: 'pending',
    });

    this.aiChecksService.runInBackground(card);
    return card;
  }

  async listForSeller(ownerId: number, shopId: number) {
    await this.shopsService.assertOwnership(ownerId, shopId);
    return this.productCardsRepository.findByShopId(shopId);
  }

  async getOwnOrThrow(ownerId: number, id: number) {
    const card = await this.productCardsRepository.findByIdAndOwner(
      id,
      ownerId,
    );
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    return card;
  }

  async updateOwn(ownerId: number, id: number, dto: UpdateProductCardDto) {
    const card = await this.getOwnOrThrow(ownerId, id);
    await this.assertCategoryChangeAllowed(card, dto.categoryId);
    const updated = await this.productCardsRepository.update(id, {
      ...dto,
      price: priceColumn(dto.price),
      status: 'pending',
    });

    await this.invalidateCache();
    this.aiChecksService.runInBackground(updated);
    return updated;
  }

  /**
   * Проверка категории при правке своего товара.
   *
   * Спрашиваем разрешение только когда раздел меняется: товар мог оказаться в
   * закрытом разделе руками администратора, и запрещать продавцу из-за этого
   * править описание собственной карточки — наказание не по адресу.
   */
  private async assertCategoryChangeAllowed(
    card: { shopId: number; categoryId: number | null },
    categoryId: number | undefined,
  ) {
    if (categoryId === undefined || categoryId === card.categoryId) return;
    const shop = await this.shopsService.getOrThrowById(card.shopId);
    await this.categoriesService.assertUsable(
      categoryId,
      shop.restrictedCategoriesEnabled,
    );
  }

  /**
   * Повторная отправка на проверку продавцом — после правки фото или описания.
   * Проверку из очереди модерации намеренно не снимаем: иначе продавец закрывал
   * бы собственный отказ, не показав его человеку. Новый вердикт вытеснит старый
   * сам, если карточка стала чистой.
   */
  async recheckOwn(ownerId: number, id: number) {
    const card = await this.getOwnOrThrow(ownerId, id);
    if (card.status === 'abolished') {
      throw new ForbiddenException(
        card.abolishReason
          ? `Товар упразднён администратором: ${card.abolishReason}`
          : 'Товар упразднён администратором — отправить на проверку нельзя',
      );
    }

    this.aiChecksService.runInBackground(card);
    return { queued: true };
  }

  async removeOwn(ownerId: number, id: number) {
    await this.getOwnOrThrow(ownerId, id);
    await this.productCardsRepository.delete(id);
    await this.invalidateCache();
  }

  /** Снимает и ИИ-скрытие, и упразднение — как и восстановление магазина. */
  /**
   * Возврат товара в выдачу — он же ручное одобрение после ИИ-проверки,
   * поэтому снимаем проверку с очереди модерации: решение принято человеком.
   */
  async adminRestore(id: number) {
    await this.getOrThrow(id);
    const restored = await this.productCardsRepository.restore(id);
    await this.aiChecksService.markReviewed(id);
    await this.invalidateCache();
    return restored;
  }

  async adminAbolish(id: number, reason: string) {
    await this.getOrThrow(id);
    const abolished = await this.productCardsRepository.abolish(id, reason);
    await this.invalidateCache();
    return abolished;
  }

  async findAllForAdmin(query: FindAdminProductCardsQueryDto) {
    const { data, total, page, limit } =
      await this.productCardsRepository.findAllForAdmin(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  /** Создание товара администратором в любом магазине — без проверки владения. */
  async adminCreate(shopId: number, dto: CreateProductCardDto) {
    const shop = await this.shopsService.getOrThrowById(shopId);
    this.shopsService.assertAcceptsProducts(shop);
    await this.categoriesService.assertExists(dto.categoryId);
    const card = await this.productCardsRepository.create({
      shopId,
      categoryId: dto.categoryId,
      name: dto.name,
      description: dto.description,
      photos: dto.photos,
      price: priceColumn(dto.price) ?? null,
      state: dto.state,
      characteristics: dto.characteristics,
      status: 'pending',
    });
    this.aiChecksService.runInBackground(card);
    return card;
  }

  async adminUpdate(id: number, dto: UpdateProductCardDto) {
    await this.getOrThrow(id);
    await this.categoriesService.assertExists(dto.categoryId);
    const updated = await this.productCardsRepository.update(id, {
      ...dto,
      price: priceColumn(dto.price),
      status: 'pending',
    });
    await this.invalidateCache();
    this.aiChecksService.runInBackground(updated);
    return updated;
  }

  /** Ручной повтор ИИ-проверки — например, после сбоя сервиса. */
  async adminRecheck(id: number) {
    const card = await this.getOrThrow(id);
    await this.aiChecksService.markReviewed(id);
    this.aiChecksService.runInBackground(card);
    return { queued: true };
  }

  /** Полное удаление админом — в отличие от упразднения, восстановить нельзя. */
  async adminRemove(id: number) {
    await this.getOrThrow(id);
    await this.productCardsRepository.delete(id);
    await this.invalidateCache();
  }

  async getPublicById(id: number) {
    const key = productItemKey(id);
    const cached = await this.redis.get<PublicItem>(key);
    if (cached) return cached;

    const card = await this.productCardsRepository.findPublicById(id);
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    await this.redis.set(key, card, PRODUCT_ITEM_TTL_SEC);
    return card;
  }

  async findPublicList(query: FindProductCardsQueryDto) {
    const key = productListKey({ ...query });
    const cached = await this.redis.get<PublicList>(key);
    const result =
      cached ??
      (await this.productCardsRepository.findPublicList(
        query,
        await this.resolveCategoryIds(query),
      ));
    if (!cached) {
      await this.redis.set(key, result, PRODUCT_LIST_TTL_SEC);
    }

    const { data, total, page, limit } = result;
    return buildPaginatedResult(data, total, page, limit);
  }

  listPublicIds() {
    return this.productCardsRepository.findPublicIds();
  }

  /**
   * Превращает фильтр каталога в список id ветки. `undefined` — фильтра нет;
   * пустой массив — категорию запросили, но её не существует, и выдача должна
   * быть пустой, а не полной.
   */
  private async resolveCategoryIds(
    query: FindProductCardsQueryDto,
  ): Promise<number[] | undefined> {
    if (query.category_id !== undefined) {
      return this.categoriesService.findSubtreeIds(query.category_id);
    }
    if (query.category) {
      const root = await this.categoriesService.findRootBySlug(query.category);
      return root ? this.categoriesService.findSubtreeIds(root.id) : [];
    }
    return undefined;
  }

  /**
   * Любая запись меняет выдачу целиком: фильтров много, точечно инвалидировать
   * нечего. Публичный метод, потому что витрину меняют и снаружи модуля —
   * например, модерация отзыва пересчитывает рейтинг в карточках.
   */
  invalidateCache() {
    return this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
  }

  private async getOrThrow(id: number) {
    const card = await this.productCardsRepository.findById(id);
    if (!card) {
      throw new NotFoundException('Товар не найден');
    }
    return card;
  }
}
