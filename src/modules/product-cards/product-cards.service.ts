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
import { SearchStatsService } from '../search-stats/search-stats.service';
import { SEARCH_HIT_SHOP_LIMIT } from '../search-stats/search-stats.util';
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
    private readonly searchStats: SearchStatsService,
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

    return this.createCard(shopId, dto);
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
    this.assertNotAbolished(card);
    await this.assertCategoryChangeAllowed(card, dto.categoryId);
    return this.updateCard(id, dto);
  }

  private async createCard(shopId: number, dto: CreateProductCardDto) {
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

  private async updateCard(id: number, dto: UpdateProductCardDto) {
    const updated = await this.productCardsRepository.update(id, {
      ...dto,
      price: priceColumn(dto.price),
      status: 'pending',
    });
    await this.invalidateCache();
    this.aiChecksService.runInBackground(updated);
    return updated;
  }

  private async assertCategoryChangeAllowed(
    card: { shopId: number; categoryId: number | null },
    categoryId: number | undefined,
  ) {
    if (categoryId === undefined || categoryId === card.categoryId) return;
    const shop = await this.shopsService.getOrThrow(card.shopId);
    await this.categoriesService.assertUsable(
      categoryId,
      shop.restrictedCategoriesEnabled,
    );
  }

  async recheckOwn(ownerId: number, id: number) {
    const card = await this.getOwnOrThrow(ownerId, id);
    this.assertNotAbolished(card);

    this.aiChecksService.runInBackground(card);
    return { queued: true };
  }
  private assertNotAbolished(card: {
    status: string;
    abolishReason: string | null;
  }) {
    if (card.status !== 'abolished') return;
    throw new ForbiddenException(
      card.abolishReason
        ? `Товар упразднён администратором: ${card.abolishReason}`
        : 'Товар упразднён администратором — изменить его нельзя',
    );
  }

  async removeOwn(ownerId: number, id: number) {
    await this.getOwnOrThrow(ownerId, id);
    await this.productCardsRepository.delete(id);
    await this.invalidateCache();
  }

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

  async adminCreate(shopId: number, dto: CreateProductCardDto) {
    const shop = await this.shopsService.getOrThrow(shopId);
    this.shopsService.assertAcceptsProducts(shop);
    await this.categoriesService.assertExists(dto.categoryId);
    return this.createCard(shopId, dto);
  }

  async adminUpdate(id: number, dto: UpdateProductCardDto) {
    await this.getOrThrow(id);
    await this.categoriesService.assertExists(dto.categoryId);
    return this.updateCard(id, dto);
  }

  async adminRecheck(id: number) {
    const card = await this.getOrThrow(id);
    await this.aiChecksService.markReviewed(id);
    this.aiChecksService.runInBackground(card);
    return { queued: true };
  }

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

  async findPublicList(query: FindProductCardsQueryDto, userAgent?: string) {
    const { visitor_id: visitorId, ...cacheable } = query;
    const key = query.sort === 'random' ? null : productListKey(cacheable);
    const cached = key ? await this.redis.get<PublicList>(key) : null;
    const categoryIds = cached
      ? undefined
      : await this.resolveCategoryIds(query);
    const result =
      cached ??
      (await this.productCardsRepository.findPublicList(query, categoryIds));
    if (key && !cached) {
      await this.redis.set(key, result, PRODUCT_LIST_TTL_SEC);
    }

    this.recordSearchHit(query, visitorId, userAgent, categoryIds);

    const { data, total, page, limit } = result;
    return buildPaginatedResult(data, total, page, limit);
  }

  private recordSearchHit(
    query: FindProductCardsQueryDto,
    visitorId: string | undefined,
    userAgent: string | undefined,
    categoryIds: number[] | undefined,
  ): void {
    if (!query.q || (query.page ?? 1) !== 1) return;

    this.searchStats.record(query.q, visitorId, userAgent, async () =>
      this.productCardsRepository.findMatchingShopIds(
        query,
        categoryIds ?? (await this.resolveCategoryIds(query)),
        SEARCH_HIT_SHOP_LIMIT,
      ),
    );
  }

  listPublicIds() {
    return this.productCardsRepository.findPublicIds();
  }

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
