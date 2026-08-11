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
      limit: isAdmin ? null : row.limit,
      used: row.used,
    };
  }

  /**
   * Занимает квоту под `want` картинок одним UPDATE.
   *
   * Условие проверяется тем же оператором, который пишет счётчик, поэтому два
   * одновременных запроса не могут оба увидеть свободный остаток: Postgres
   * сериализует их на блокировке строки. Возвращает false, если места нет.
   *
   * Безлимитным (и администраторам) резерв не нужен — им всегда true.
   */
  async reserve(userId: number, want: number): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({ imageGenReserved: sql`${users.imageGenReserved} + ${want}` })
      .where(
        and(
          eq(users.id, userId),
          sql`(
            ${users.imageGenLimit} IS NULL
            OR (select count(*)::int from ${generatedImages}
                where ${generatedImages.userId} = ${users.id})
               + ${users.imageGenReserved} + ${want} <= ${users.imageGenLimit}
          )`,
        ),
      )
      .returning({ id: users.id });

    return rows.length > 0;
  }

  /**
   * Освобождает резерв. GREATEST на случай рассинхрона: уйти в минус счётчику
   * нельзя, иначе он начнёт выдавать квоту сверх лимита.
   */
  async release(userId: number, want: number): Promise<void> {
    await this.db
      .update(users)
      .set({
        imageGenReserved: sql`greatest(0, ${users.imageGenReserved} - ${want})`,
      })
      .where(eq(users.id, userId));
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
