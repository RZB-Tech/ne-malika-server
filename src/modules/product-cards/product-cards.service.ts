import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductCardsRepository } from './product-cards.repository';
import { ShopsService } from '../shops/shops.service';
import { AiChecksService } from '../ai/ai-checks.service';
import { RedisService } from '../redis/redis.service';
import { CreateProductCardDto } from './dto/create-product-card.dto';
import { UpdateProductCardDto } from './dto/update-product-card.dto';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';
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

@Injectable()
export class ProductCardsService {
  constructor(
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly shopsService: ShopsService,
    private readonly aiChecksService: AiChecksService,
    private readonly redis: RedisService,
  ) {}

  async createForSeller(
    ownerId: number,
    shopId: number,
    dto: CreateProductCardDto,
  ) {
    await this.shopsService.assertOwnership(ownerId, shopId);

    const card = await this.productCardsRepository.create({
      shopId,
      name: dto.name,
      description: dto.description,
      photos: dto.photos,
      price: dto.price.toString(),
      state: dto.state,
      characteristics: dto.characteristics,
    });

    await this.invalidateCache();
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
    await this.getOwnOrThrow(ownerId, id);
    const updated = await this.productCardsRepository.update(id, {
      ...dto,
      price: dto.price?.toString(),
    });

    await this.invalidateCache();
    // Правка меняет то, что видит покупатель, — проверяем заново.
    this.aiChecksService.runInBackground(updated);
    return updated;
  }

  async removeOwn(ownerId: number, id: number) {
    await this.getOwnOrThrow(ownerId, id);
    await this.productCardsRepository.delete(id);
    await this.invalidateCache();
  }

  async adminRestore(id: number) {
    const card = await this.getOrThrow(id);
    if (card.status === 'abolished') {
      throw new BadRequestException(
        'Товар упразднён администратором — используйте отдельный процесс восстановления, а не снятие ИИ-скрытия',
      );
    }
    const restored = await this.productCardsRepository.restore(id);
    await this.invalidateCache();
    return restored;
  }

  async adminAbolish(id: number, reason: string) {
    await this.getOrThrow(id);
    const abolished = await this.productCardsRepository.abolish(id, reason);
    await this.invalidateCache();
    return abolished;
  }

  async activateAll() {
    const updated = await this.productCardsRepository.activateAll();
    await this.invalidateCache();
    return { updated };
  }

  async passAllAiChecks() {
    return { updated: await this.productCardsRepository.passAllAiChecks() };
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
      cached ?? (await this.productCardsRepository.findPublicList(query));
    if (!cached) {
      await this.redis.set(key, result, PRODUCT_LIST_TTL_SEC);
    }

    const { data, total, page, limit } = result;
    return buildPaginatedResult(data, total, page, limit);
  }

  listPublicIds() {
    return this.productCardsRepository.findPublicIds();
  }

  /** Любая запись меняет выдачу целиком: фильтров много, точечно инвалидировать нечего. */
  private invalidateCache() {
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
