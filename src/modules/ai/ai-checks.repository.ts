import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { recomputeShopRating } from '../../db/rating';
import {
  aiProductChecks,
  AiProductCheck,
  ProductCard,
  productCards,
  shops,
} from '../../db/schema';

export interface AiReviewRow extends Record<string, unknown> {
  checkId: number;
  productCardId: number;
  verdict: 'pass' | 'warn' | 'fail';
  summary: string | null;
  error: string | null;
  checkedAt: string;
  reviewedAt: string | null;
  name: string;
  price: string | null;
  photos: string[];
  status: 'active' | 'hidden' | 'abolished' | 'pending';
  description: string | null;
  shopName: string;
}

@Injectable()
export class AiChecksRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async recordDecision(
    card: ProductCard,
    data: Omit<typeof aiProductChecks.$inferInsert, 'productCardId'>,
    status?: 'active' | 'hidden',
  ): Promise<boolean> {
    const versionEnd = new Date(card.updatedAt.getTime() + 1);

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(productCards)
        .set({ ...(status && { status }), updatedAt: new Date() })
        .where(
          and(
            eq(productCards.id, card.id),
            inArray(productCards.status, ['active', 'pending', 'hidden']),
            sql`${productCards.updatedAt} >= ${card.updatedAt}`,
            sql`${productCards.updatedAt} < ${versionEnd}`,
          ),
        )
        .returning({ id: productCards.id });

      if (rows.length === 0) return false;

      await tx.insert(aiProductChecks).values({
        ...data,
        productCardId: card.id,
      });
      return true;
    });
  }

  findLatestByProductId(
    productCardId: number,
  ): Promise<AiProductCheck | undefined> {
    return this.db.query.aiProductChecks.findFirst({
      where: eq(aiProductChecks.productCardId, productCardId),
      orderBy: desc(aiProductChecks.createdAt),
    });
  }

  findProductById(productCardId: number): Promise<ProductCard | undefined> {
    return this.db.query.productCards.findFirst({
      where: eq(productCards.id, productCardId),
    });
  }

  findAdminNotificationData(productCardId: number) {
    return this.db
      .select({
        id: productCards.id,
        name: productCards.name,
        photos: productCards.photos,
        shopName: shops.name,
      })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(eq(productCards.id, productCardId))
      .limit(1)
      .then((rows) => rows[0]);
  }

  restoreProduct(productCardId: number): Promise<ProductCard | undefined> {
    return this.db
      .update(productCards)
      .set({
        status: 'active',
        abolishReason: null,
        abolishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(productCards.id, productCardId))
      .returning()
      .then((rows) => rows[0]);
  }

  async deleteProduct(productCardId: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(productCards)
        .where(eq(productCards.id, productCardId))
        .returning({ shopId: productCards.shopId });

      if (!deleted) return false;
      await recomputeShopRating(tx, deleted.shopId);
      return true;
    });
  }

  async findNeedingReview(limit: number, offset: number) {
    const result = await this.db.execute<AiReviewRow>(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (c.product_card_id)
          c.id                AS "checkId",
          c.product_card_id   AS "productCardId",
          c.verdict           AS "verdict",
          c.summary           AS "summary",
          c.error             AS "error",
          c.created_at        AS "checkedAt",
          c.reviewed_at       AS "reviewedAt",
          p.name              AS "name",
          p.price             AS "price",
          p.photos            AS "photos",
          p.status            AS "status",
          p.description       AS "description",
          s.name              AS "shopName"
        FROM ai_product_checks c
        JOIN product_cards p ON p.id = c.product_card_id
        JOIN shops s ON s.id = p.shop_id
        ORDER BY c.product_card_id, c.created_at DESC
      ) latest
      WHERE latest."reviewedAt" IS NULL
        AND (latest."error" IS NOT NULL OR latest."verdict" = 'fail')
      ORDER BY latest."checkedAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const totals = await this.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS "count" FROM (
        SELECT DISTINCT ON (c.product_card_id)
          c.verdict, c.error, c.reviewed_at AS "reviewedAt"
        FROM ai_product_checks c
        JOIN product_cards p ON p.id = c.product_card_id
        ORDER BY c.product_card_id, c.created_at DESC
      ) latest
      WHERE latest."reviewedAt" IS NULL
        AND (latest."error" IS NOT NULL OR latest.verdict = 'fail')
    `);

    return { data: result.rows, total: totals.rows[0]?.count ?? 0 };
  }

  async markLatestReviewed(productCardId: number): Promise<void> {
    const latest = await this.findLatestByProductId(productCardId);
    if (!latest || latest.reviewedAt) return;

    await this.db
      .update(aiProductChecks)
      .set({ reviewedAt: new Date() })
      .where(
        and(
          eq(aiProductChecks.id, latest.id),
          isNull(aiProductChecks.reviewedAt),
        ),
      );
  }

  findStuckPending(olderThan: Date, limit: number): Promise<ProductCard[]> {
    return this.db
      .select()
      .from(productCards)
      .where(
        and(
          eq(productCards.status, 'pending'),
          lt(productCards.updatedAt, olderThan),
        ),
      )
      .orderBy(productCards.updatedAt)
      .limit(limit);
  }
}
