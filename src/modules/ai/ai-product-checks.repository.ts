import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { NewAiProductCheck, aiProductChecks } from '../../db/schema';

@Injectable()
export class AiProductChecksRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewAiProductCheck) {
    return this.db
      .insert(aiProductChecks)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findLatestByProductCardId(productCardId: number) {
    return this.db.query.aiProductChecks.findFirst({
      where: eq(aiProductChecks.productCardId, productCardId),
      orderBy: desc(aiProductChecks.createdAt),
    });
  }
}
