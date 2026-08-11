import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { generatedImages, users } from '../../db/schema';

/** Что можно и сколько осталось. `limit: null` — без ограничения. */
export interface ImageGenQuota {
  allowed: boolean;
  limit: number | null;
  used: number;
}

@Injectable()
export class ImageGenRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Право на генерацию и расход. Считаем одним запросом: два похода в базу
   * ради двух чисел на каждый клик по кнопке — лишняя латентность там, где
   * человек и так ждёт картинку.
   *
   * Администратору доступ даёт роль, флаг для него не смотрим.
   */
  async quota(userId: number, isAdmin: boolean): Promise<ImageGenQuota> {
    const rows = await this.db
      .select({
        enabled: users.imageGenEnabled,
        limit: users.imageGenLimit,
        used: sql<number>`(
          select count(*)::int from ${generatedImages}
          where ${generatedImages.userId} = ${users.id}
        )`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return { allowed: false, limit: 0, used: 0 };

    return {
      allowed: isAdmin || row.enabled,
      // У администратора лимита нет: он и раздаёт квоты остальным.
      limit: isAdmin ? null : row.limit,
      used: row.used,
    };
  }

  record(
    rows: { userId: number; sourceKey: string; key: string; prompt: string }[],
  ) {
    if (rows.length === 0) return Promise.resolve([]);
    return this.db.insert(generatedImages).values(rows).returning();
  }

  /**
   * Раньше нарисованное по этому же фото. Ограничение по автору намеренное:
   * ключ фотографии — это просто uuid, и без него чужую галерею открыл бы
   * любой, кто его подобрал.
   */
  history(userId: number, sourceKey: string, limit: number) {
    return this.db
      .select({
        key: generatedImages.key,
        prompt: generatedImages.prompt,
        createdAt: generatedImages.createdAt,
      })
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.sourceKey, sourceKey),
          eq(generatedImages.userId, userId),
        ),
      )
      .orderBy(desc(generatedImages.createdAt))
      .limit(limit);
  }

  /** Выдача доступа и лимита администратором. */
  async setAccess(
    userId: number,
    data: { enabled: boolean; limit: number | null },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({
        imageGenEnabled: data.enabled,
        imageGenLimit: data.limit,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }
}
