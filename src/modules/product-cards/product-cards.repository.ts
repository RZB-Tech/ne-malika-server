import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import {
  aiProductChecks,
  NewProductCard,
  ProductCard,
  productCards,
  shops,
} from '../../db/schema';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';
import { FindAdminProductCardsQueryDto } from './dto/find-admin-product-cards-query.dto';

/** Проекция товара для покупателя: без внутренних полей модерации и эмбеддинга. */
const PUBLIC_FIELDS = {
  id: productCards.id,
  shopId: productCards.shopId,
  name: productCards.name,
  description: productCards.description,
  photos: productCards.photos,
  price: productCards.price,
  state: productCards.state,
  createdAt: productCards.createdAt,
  shopName: shops.name,
  characteristics: productCards.characteristics,
};

/** То же плюс поля модерации: администратор должен видеть, почему товар скрыт. */
const ADMIN_FIELDS = {
  ...PUBLIC_FIELDS,
  status: productCards.status,
  abolishReason: productCards.abolishReason,
  abolishedAt: productCards.abolishedAt,
  updatedAt: productCards.updatedAt,
  shopStatus: shops.status,
};

const COUNT = { count: sql<number>`count(*)::int` };

function resolveSort(sort?: string) {
  switch (sort) {
    case 'price_asc':
      return asc(productCards.price);
    case 'price_desc':
      return desc(productCards.price);
    default:
      return desc(productCards.createdAt);
  }
}

@Injectable()
export class ProductCardsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewProductCard): Promise<ProductCard> {
    return this.db
      .insert(productCards)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findById(id: number): Promise<ProductCard | undefined> {
    return this.db.query.productCards.findFirst({
      where: eq(productCards.id, id),
    });
  }

  /** Список товаров конкретного магазина в кабинете продавца — включая упразднённые. */
  findByShopId(shopId: number): Promise<ProductCard[]> {
    return this.db
      .select()
      .from(productCards)
      .where(eq(productCards.shopId, shopId))
      .orderBy(desc(productCards.createdAt));
  }

  /** Проверка владения товаром через цепочку product_card → shop → owner. */
  findByIdAndOwner(id: number, ownerId: number) {
    return this.db
      .select({ card: productCards })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(eq(productCards.id, id), eq(shops.owner, ownerId)))
      .then((r) => r[0]?.card);
  }

  /** Публичная карточка товара: сам товар и его магазин должны быть активны. */
  findPublicById(id: number) {
    return this.db
      .select(PUBLIC_FIELDS)
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(eq(productCards.id, id), ...publicConditions()))
      .then((r) => r[0]);
  }

  async findPublicList(query: FindProductCardsQueryDto) {
    const { page, limit, offset } = resolvePage(query);
    const where = and(...publicConditions(query));

    const [data, totalRows] = await Promise.all([
      this.db
        .select(PUBLIC_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where)
        .orderBy(resolveSort(query.sort))
        .limit(limit)
        .offset(offset),
      this.db
        .select(COUNT)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /**
   * Выдача администратора: все статусы, включая упразднённые и скрытые ИИ.
   * Поиск здесь по ILIKE, а не по search_vector: индекс полнотекстового поиска
   * строится только по активным полям карточки, а искать нужно и среди скрытых.
   */
  async findAllForAdmin(query: FindAdminProductCardsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const conditions: SQL[] = [];
    if (query.status) {
      conditions.push(eq(productCards.status, query.status));
    }
    if (query.shop_id) {
      conditions.push(eq(productCards.shopId, query.shop_id));
    }
    if (query.q) {
      conditions.push(
        or(
          ilike(productCards.name, `%${query.q}%`),
          ilike(shops.name, `%${query.q}%`),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(ADMIN_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where)
        .orderBy(desc(productCards.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select(COUNT)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /** Только id и дата — для sitemap, без тяжёлых полей и без пагинации по кругу. */
  findPublicIds(): Promise<{ id: number; updatedAt: Date }[]> {
    return this.db
      .select({ id: productCards.id, updatedAt: productCards.updatedAt })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(...publicConditions()))
      .orderBy(desc(productCards.updatedAt));
  }

  update(id: number, data: Partial<NewProductCard>): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }

  delete(id: number): Promise<void> {
    return this.db
      .delete(productCards)
      .where(eq(productCards.id, id))
      .then(() => undefined);
  }

  abolish(id: number, reason: string): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({
        status: 'abolished',
        abolishReason: reason,
        abolishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }

  restore(id: number): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({
        status: 'active',
        abolishReason: null,
        abolishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }

  /** Массовое обслуживание: снять скрытие со всех товаров. Только администратор. */
  activateAll(): Promise<number> {
    return this.db
      .update(productCards)
      .set({ status: 'active', updatedAt: new Date() })
      .returning({ id: productCards.id })
      .then((r) => r.length);
  }

  /** Массовое обслуживание: пометить все ИИ-проверки как пройденные. Только администратор. */
  passAllAiChecks(): Promise<number> {
    return this.db
      .update(aiProductChecks)
      .set({ verdict: 'pass' })
      .returning({ id: aiProductChecks.id })
      .then((r) => r.length);
  }
}

/**
 * Условия публичной выдачи. Активность товара и магазина — обязательная часть:
 * без неё упразднённые администратором карточки продолжали бы висеть в каталоге.
 */
function publicConditions(query: FindProductCardsQueryDto = {}): SQL[] {
  const conditions: SQL[] = [
    eq(productCards.status, 'active'),
    eq(shops.status, 'active'),
  ];

  if (query.q) {
    // Полнотекстовый поиск по GIN-индексу (миграция 0002), а не ILIKE '%...%',
    // который заставлял Postgres читать таблицу целиком.
    conditions.push(
      sql`${productCards}.search_vector @@ websearch_to_tsquery('russian', ${query.q})`,
    );
  }
  if (query.price_min !== undefined) {
    conditions.push(gte(productCards.price, query.price_min.toString()));
  }
  if (query.price_max !== undefined) {
    conditions.push(lte(productCards.price, query.price_max.toString()));
  }
  if (query.state) {
    conditions.push(eq(productCards.state, query.state));
  }
  if (query.shop_id) {
    conditions.push(eq(productCards.shopId, query.shop_id));
  }

  return conditions;
}
