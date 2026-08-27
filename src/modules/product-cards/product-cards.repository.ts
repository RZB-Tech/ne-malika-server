import { Inject, Injectable } from '@nestjs/common';
import {
  SQL,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { VISIBLE_PRODUCT } from '../../db/public-products';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import {
  categories,
  NewProductCard,
  ProductCard,
  productCards,
  shops,
} from '../../db/schema';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';
import { FindAdminProductCardsQueryDto } from './dto/find-admin-product-cards-query.dto';
import { recomputeShopRating } from '../../db/rating';
import {
  buildProductSearch,
  escapeLike,
  type ProductSearch,
} from './product-search';
import {
  PAID_PLANS,
  PLAN_LIMITS,
} from '../subscriptions/subscriptions.constants';

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
  ratingAvg: productCards.ratingAvg,
  ratingCount: productCards.ratingCount,
  characteristics: productCards.characteristics,
  categoryId: productCards.categoryId,
  categorySlug: categories.slug,
  categoryNameRu: categories.nameRu,
  categoryNameUzLatn: categories.nameUzLatn,
  categoryNameUzCyrl: categories.nameUzCyrl,
};

const ADMIN_FIELDS = {
  ...PUBLIC_FIELDS,
  status: productCards.status,
  abolishReason: productCards.abolishReason,
  abolishedAt: productCards.abolishedAt,
  updatedAt: productCards.updatedAt,
  shopStatus: shops.status,
};

const COUNT = { count: sql<number>`count(*)::int` };

const SEARCH_DOCUMENT = sql`coalesce(${productCards.name}, '') || ' ' || coalesce(${productCards.description}, '')`;

const SEARCH_VECTOR = sql`(to_tsvector('russian', ${SEARCH_DOCUMENT}) || to_tsvector('simple', ${SEARCH_DOCUMENT}))`;

function randomOrder(seed: string, promo: Promo | null): SQL[] {
  if (!promo) {
    return [
      sql`md5(${seed} || ${productCards.id}::text)`,
      asc(productCards.id),
    ];
  }

  return [
    desc(sql`power(${shuffleKey(seed)}, 1.0 / ${promoWeightSql(promo.at)})`),
    asc(productCards.id),
  ];
}

export const PROMO_BUCKET_SEC = 300;

export function promoBucket(now: Date = new Date()): Date {
  const ms = PROMO_BUCKET_SEC * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

interface Promo {
  at: Date;
}

function shuffleKey(seed: string): SQL {
  return sql`((('x' || substr(md5(${seed} || ${productCards.id}::text), 1, 7))::bit(28)::int)::double precision / 268435455.0)`;
}

function promoWeightSql(at: Date): SQL {
  const alive = gt(shops.subscriptionUntil, at);
  const branches = PAID_PLANS.filter(
    (plan) => PLAN_LIMITS[plan].promoWeight !== 1,
  ).map(
    (plan) =>
      sql`when ${alive} and ${eq(shops.subscriptionPlan, plan)} then ${PLAN_LIMITS[plan].promoWeight}::double precision`,
  );

  if (branches.length === 0) return sql`1::double precision`;

  return sql`(case ${sql.join(branches, sql` `)} else 1::double precision end)`;
}

function isGeneralCatalog(
  query: FindProductCardsQueryDto,
  categoryIds?: number[],
): boolean {
  return (
    !query.q &&
    categoryIds === undefined &&
    query.ids === undefined &&
    query.shop_id === undefined &&
    query.price_min === undefined &&
    query.price_max === undefined &&
    !query.state
  );
}

function resolveSort(
  query: FindProductCardsQueryDto,
  search: ProductSearch | null,
  promo: Promo | null,
): SQL[] {
  if (query.sort === 'random') {
    return randomOrder(query.seed ?? '', promo);
  }
  if (query.sort === 'price_asc') {
    return [sql`${productCards.price} asc nulls last`];
  }
  if (query.sort === 'price_desc') {
    return [sql`${productCards.price} desc nulls last`];
  }

  if (!search) return [desc(productCards.createdAt)];

  return [
    desc(
      sql`ts_rank(to_tsvector('russian', coalesce(${productCards.name}, '')), to_tsquery('russian', ${search.queries[0]}), 1)`,
    ),
    desc(productCards.createdAt),
  ];
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

  findByShopId(shopId: number): Promise<ProductCard[]> {
    return this.db
      .select()
      .from(productCards)
      .where(eq(productCards.shopId, shopId))
      .orderBy(desc(productCards.createdAt));
  }

  findByIdAndOwner(id: number, ownerId: number) {
    return this.db
      .select({ card: productCards })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(eq(productCards.id, id), eq(shops.owner, ownerId)))
      .then((r) => r[0]?.card);
  }

  findPublicById(id: number) {
    return this.db
      .select(PUBLIC_FIELDS)
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .leftJoin(categories, eq(productCards.categoryId, categories.id))
      .where(and(eq(productCards.id, id), ...publicConditions()))
      .then((r) => r[0]);
  }

  async findPublicList(
    query: FindProductCardsQueryDto,
    categoryIds?: number[],
  ) {
    const { page, limit, offset } = resolvePage(query);
    const search = query.q ? buildProductSearch(query.q) : null;
    const where = and(...publicConditions(query, categoryIds, search));

    const promo =
      query.sort === 'random' && isGeneralCatalog(query, categoryIds)
        ? { at: promoBucket() }
        : null;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(PUBLIC_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .leftJoin(categories, eq(productCards.categoryId, categories.id))
        .where(where)
        .orderBy(...resolveSort(query, search, promo))
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

  async findMatchingShopIds(
    query: FindProductCardsQueryDto,
    categoryIds: number[] | undefined,
    limit: number,
  ): Promise<number[]> {
    const search = query.q ? buildProductSearch(query.q) : null;

    const rows = await this.db
      .selectDistinct({ shopId: productCards.shopId })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(...publicConditions(query, categoryIds, search)))
      .limit(limit);

    return rows.map((row) => row.shopId);
  }

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
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(
        or(ilike(productCards.name, pattern), ilike(shops.name, pattern))!,
      );
    }
    if (query.uncategorized) {
      conditions.push(isNull(productCards.categoryId));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(ADMIN_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .leftJoin(categories, eq(productCards.categoryId, categories.id))
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

  async delete(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(productCards)
        .where(eq(productCards.id, id))
        .returning({ shopId: productCards.shopId });

      if (deleted) await recomputeShopRating(tx, deleted.shopId);
    });
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
}

function publicConditions(
  query: FindProductCardsQueryDto = {},
  categoryIds?: number[],
  search: ProductSearch | null = null,
): SQL[] {
  const conditions: SQL[] = [...VISIBLE_PRODUCT];

  if (categoryIds) {
    conditions.push(
      categoryIds.length > 0
        ? inArray(productCards.categoryId, categoryIds)
        : sql`false`,
    );
  }

  if (query.ids) {
    conditions.push(
      query.ids.length > 0 ? inArray(productCards.id, query.ids) : sql`false`,
    );
  }
  if (query.q) {
    conditions.push(search ? searchCondition(search) : sql`false`);
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

function searchCondition(search: ProductSearch): SQL {
  const branches: SQL[] = search.queries.map(
    (query) => sql`${SEARCH_VECTOR} @@ to_tsquery('russian', ${query})`,
  );

  if (search.like) {
    branches.push(ilike(productCards.name, search.like));
    branches.push(ilike(shops.name, search.like));
  }

  return or(...branches)!;
}
