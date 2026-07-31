import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  aiProductChecks,
  AiProductCheck,
  NewAiProductCheck,
  productCards,
} from '../../db/schema';

/** Строка очереди ручной модерации: товар + его последняя проверка. */
export interface AiReviewRow extends Record<string, unknown> {
  checkId: number;
  productCardId: number;
  verdict: 'pass' | 'warn' | 'fail';
  summary: string | null;
  error: string | null;
  checkedAt: string;
  name: string;
  price: string;
  photos: string[];
  status: 'active' | 'hidden' | 'abolished';
  description: string | null;
  shopName: string;
}

@Injectable()
export class AiChecksRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewAiProductCheck): Promise<AiProductCheck> {
    return this.db
      .insert(aiProductChecks)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findLatestByProductId(
    productCardId: number,
  ): Promise<AiProductCheck | undefined> {
    return this.db.query.aiProductChecks.findFirst({
      where: eq(aiProductChecks.productCardId, productCardId),
      orderBy: desc(aiProductChecks.createdAt),
    });
  }

  /**
   * Проверки, требующие внимания человека: сервис не ответил (error) либо
   * модель забраковала товар (fail). DISTINCT ON берёт последнюю проверку на
   * товар — предыдущие попытки в очередь попадать не должны.
   */
  async findNeedingReview(): Promise<AiReviewRow[]> {
    const result = await this.db.execute<AiReviewRow>(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (c.product_card_id)
          c.id                AS "checkId",
          c.product_card_id   AS "productCardId",
          c.verdict           AS "verdict",
          c.summary           AS "summary",
          c.error             AS "error",
          c.created_at        AS "checkedAt",
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
      WHERE latest."error" IS NOT NULL OR latest."verdict" = 'fail'
      ORDER BY latest."checkedAt" DESC
    `);
    return result.rows;
  }

  /**
   * Скрытие по вердикту fail. Прямой запрос, а не через ProductCardsService —
   * иначе модули ссылались бы друг на друга по кругу.
   * Упразднённые администратором не трогаем: решение человека выше решения модели.
   */
  async hideProduct(id: number): Promise<void> {
    await this.db
      .update(productCards)
      .set({ status: 'hidden', updatedAt: new Date() })
      .where(and(eq(productCards.id, id), eq(productCards.status, 'active')));
  }
}
