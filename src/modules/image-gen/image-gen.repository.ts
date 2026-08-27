import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { generatedImages } from '../../db/schema';

@Injectable()
export class ImageGenRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  record(
    rows: { userId: number; sourceKey: string; key: string; prompt: string }[],
  ) {
    if (rows.length === 0) return Promise.resolve([]);
    return this.db.insert(generatedImages).values(rows).returning();
  }

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
}
