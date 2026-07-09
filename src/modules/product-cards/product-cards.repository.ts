import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  NewProductCard,
  ProductCard,
  productCards,
  shops,
} from '../../db/schema';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';

interface BaseFilters {
  price_min?: number;
  price_max?: number;
  state?: 'new' | 'old';
  shop_id?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  limit?: number;
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
      .select({
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
      })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(
        and(
          eq(productCards.id, id),
          eq(productCards.status, 'active'),
          eq(shops.status, 'active'),
        ),
      )
      .then((r) => r[0]);
  }

  async findPublicList(query: FindProductCardsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [
      eq(productCards.status, 'active'),
      eq(shops.status, 'active'),
    ];

    if (query.q) {
      conditions.push(
        or(
          ilike(productCards.name, `%${query.q}%`),
          ilike(productCards.description, `%${query.q}%`),
        )!,
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

    const whereClause = and(...conditions);
    const orderBy = this.resolveSort(query.sort);

    const selectFields = {
      id: productCards.id,
      shopId: productCards.shopId,
      name: productCards.name,
      description: productCards.description,
      photos: productCards.photos,
      price: productCards.price,
      state: productCards.state,
      createdAt: productCards.createdAt,
      shopName: shops.name,
    };

    const [data, totalRows] = await Promise.all([
      this.db
        .select(selectFields)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(whereClause),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
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

  async hide(id: number): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({ status: 'hidden', updatedAt: new Date() })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }

  async restore(id: number): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }
  async updateEmbedding(id: number, embedding: number[]): Promise<void> {
    return this.db
      .update(productCards)
      .set({ embedding, updatedAt: new Date() })
      .where(eq(productCards.id, id))
      .then(() => undefined);
  }

  async fullTextSearch(prompt: string, filters: BaseFilters) {
    const conditions = this.buildBaseConditions(filters);
    conditions.push(
      sql`${productCards}.search_vector @@ websearch_to_tsquery('russian', ${prompt})`,
    );
    const whereClause = and(...conditions);

    const selectFields = this.publicSelectFields();
    const orderBy = this.resolveSort(filters.sort);
    const limit = filters.limit ?? 20;
    const offset = ((filters.page ?? 1) - 1) * limit;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(selectFields)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(whereClause),
    ]);

    return { data, total: totalRows[0]?.count ?? 0 };
  }

  async vectorSearch(
    queryEmbedding: number[],
    filters: BaseFilters,
    limit = 20,
  ) {
    const conditions = this.buildBaseConditions(filters);
    conditions.push(sql`${productCards.embedding} IS NOT NULL`);
    const whereClause = and(...conditions);

    const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

    return this.db
      .select({
        ...this.publicSelectFields(),
        distance: sql<number>`${productCards.embedding} <=> ${embeddingLiteral}::vector`,
      })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(whereClause)
      .orderBy(sql`${productCards.embedding} <=> ${embeddingLiteral}::vector`)
      .limit(limit);
  }

  async plainSearch(filters: FindProductCardsQueryDto) {
    // Реализация идентична существующему findPublicList — см. предыдущие шаги.
    return this.findPublicList(filters);
  }

  private buildBaseConditions(filters: BaseFilters): SQL[] {
    const conditions: SQL[] = [
      eq(productCards.status, 'active'),
      eq(shops.status, 'active'),
    ];
    if (filters.price_min !== undefined) {
      conditions.push(gte(productCards.price, filters.price_min.toString()));
    }
    if (filters.price_max !== undefined) {
      conditions.push(lte(productCards.price, filters.price_max.toString()));
    }
    if (filters.state) {
      conditions.push(eq(productCards.state, filters.state));
    }
    if (filters.shop_id) {
      conditions.push(eq(productCards.shopId, filters.shop_id));
    }
    return conditions;
  }

  private publicSelectFields() {
    return {
      id: productCards.id,
      shopId: productCards.shopId,
      name: productCards.name,
      description: productCards.description,
      photos: productCards.photos,
      price: productCards.price,
      state: productCards.state,
      createdAt: productCards.createdAt,
      shopName: shops.name,
    };
  }

  private resolveSort(sort?: string) {
    switch (sort) {
      case 'price_asc':
        return asc(productCards.price);
      case 'price_desc':
        return desc(productCards.price);
      case 'newest':
      default:
        return desc(productCards.createdAt);
    }
  }
}
