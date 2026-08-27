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
    this.assertNotAbolished(card);
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
    this.assertNotAbolished(card);

    this.aiChecksService.runInBackground(card);
    return { queued: true };
  }

  /**
   * Упразднённый товар продавец не трогает вовсе.
   *
   * Не только повторная отправка на проверку, но и обычная правка: она
   * переводит карточку в `pending`, а прошедшая после этого ИИ-проверка
   * вернула бы её в выдачу — то есть любой продавец снимал бы решение
   * администратора, поправив в описании запятую.
   */
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

  /**
   * Возврат товара в выдачу — он же ручное одобрение после ИИ-проверки,
   * поэтому снимаем проверку с очереди модерации: решение принято человеком.
   * Снимает и ИИ-скрытие, и упразднение — как и восстановление магазина.
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

  async findPublicList(query: FindProductCardsQueryDto, userAgent?: string) {
    /**
     * Витрину вперемешку кэшировать нечем: зерно своё у каждого захода, и в
     * Redis копились бы тысячи ключей, которые никто не прочитает второй раз, —
     * а заодно растягивался бы сброс по префиксу, он идёт перебором ключей.
     *
     * Этим же держится продвижение подписчиков: порядок, зависящий от срока
     * подписки, существует только в `sort=random` и в Redis не попадает ни разу.
     * Понадобится продвижение в других сортировках — в ключ придётся добавить
     * корзину времени, иначе ответ, собранный при живой подписке, переживёт её
     * на весь PRODUCT_LIST_TTL_SEC:
     *   productListKey({ ...cacheable, promo: promoBucket().getTime() })
     *
     * `visitor_id` из ключа выброшен: на состав ответа он не влияет — это
     * подпись для дедупликации счётчика поисковых запросов. Оставить его в
     * ключе значило бы завести каждому посетителю личную копию одной и той же
     * страницы: попаданий ноль, ключей столько, сколько людей открыло каталог,
     * и сброс по префиксу (`RedisService.delByPrefix` идёт перебором)
     * замедляется вместе с ними.
     */
    const { visitor_id: visitorId, ...cacheable } = query;
    const key = query.sort === 'random' ? null : productListKey(cacheable);
    const cached = key ? await this.redis.get<PublicList>(key) : null;
    const result =
      cached ??
      (await this.productCardsRepository.findPublicList(
        query,
        await this.resolveCategoryIds(query),
      ));
    if (key && !cached) {
      await this.redis.set(key, result, PRODUCT_LIST_TTL_SEC);
    }

    this.recordSearchHit(query, visitorId, userAgent);

    const { data, total, page, limit } = result;
    return buildPaginatedResult(data, total, page, limit);
  }

  /**
   * Отметить поиск в счётчике «по каким запросам вас находят».
   *
   * Ничего не ждёт и ничего не возвращает: выдача покупателю уже собрана, и
   * задерживать её ради статистики нельзя — разбор в `SearchStatsService.record`.
   * Попадание в кэш считаем тоже: для покупателя это такой же поиск, а для
   * продавца — такой же показ.
   *
   * Только первая страница. Листание — то же самое обращение, и складывать его
   * значило бы объявить самым популярным запросом тот, по которому кто-то один
   * долистал до конца.
   *
   * Магазины достаются отдельным запросом по всей выдаче, а не по отданным
   * двадцати четырём карточкам, и передаются функцией, а не значением: до базы
   * дело дойдёт, только если счётчик решит, что записывать есть что.
   */
  private recordSearchHit(
    query: FindProductCardsQueryDto,
    visitorId: string | undefined,
    userAgent: string | undefined,
  ): void {
    if (!query.q || (query.page ?? 1) !== 1) return;

    this.searchStats.record(query.q, visitorId, userAgent, async () =>
      this.productCardsRepository.findMatchingShopIds(
        query,
        await this.resolveCategoryIds(query),
        SEARCH_HIT_SHOP_LIMIT,
      ),
    );
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
