import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import {
  PUBLIC_PRODUCT_SUMMARY,
  VISIBLE_PRODUCT,
  filterVisibleProductIds,
} from '../../db/public-products';
import { productCards, productViews, shops } from '../../db/schema';

const VIEW_FIELDS = {
  ...PUBLIC_PRODUCT_SUMMARY,
  viewedAt: productViews.viewedAt,
  viewCount: productViews.viewCount,
};

@Injectable()
export class ProductViewsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  filterPublicIds(ids: number[]): Promise<Set<number>> {
    return filterVisibleProductIds(this.db, ids);
  }

  record(userId: number, productCardId: number) {
    const viewedAt = new Date();
    return this.db
      .insert(productViews)
      .values({ userId, productCardId, viewedAt })
      .onConflictDoUpdate({
        target: [productViews.userId, productViews.productCardId],
        set: {
          viewedAt,
          viewCount: sql`${productViews.viewCount} + 1`,
        },
      })
      .returning()
      .then((r) => r[0]);
  }

  async merge(
    userId: number,
    items: { productCardId: number; viewedAt: Date }[],
  ): Promise<number> {
    if (items.length === 0) return 0;

    const rows = await this.db
      .insert(productViews)
      .values(items.map((i) => ({ userId, ...i })))
      .onConflictDoUpdate({
        target: [productViews.userId, productViews.productCardId],
        set: {
          viewedAt: sql`greatest(${productViews.viewedAt}, excluded.viewed_at)`,
        },
      })
      .returning({ id: productViews.id });

    return rows.length;
  }

  async findByUser(userId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);
    const where = and(eq(productViews.userId, userId), ...VISIBLE_PRODUCT);

    const [data, totalRows] = await Promise.all([
      this.db
        .select(VIEW_FIELDS)
        .from(productViews)
        .innerJoin(
          productCards,
          eq(productViews.productCardId, productCards.id),
        )
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where)
        .orderBy(desc(productViews.viewedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(productViews)
        .innerJoin(
          productCards,
          eq(productViews.productCardId, productCards.id),
        )
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  deleteOne(userId: number, productCardId: number): Promise<number> {
    return this.db
      .delete(productViews)
      .where(
        and(
          eq(productViews.userId, userId),
          eq(productViews.productCardId, productCardId),
        ),
      )
      .returning({ id: productViews.id })
      .then((r) => r.length);
  }

  clear(userId: number): Promise<number> {
    return this.db
      .delete(productViews)
      .where(eq(productViews.userId, userId))
      .returning({ id: productViews.id })
      .then((r) => r.length);
  }
}
