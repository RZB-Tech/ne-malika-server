import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  aiProductChecks,
  AiProductCheck,
  NewAiProductCheck,
  productCards,
} from '../../db/schema';

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
