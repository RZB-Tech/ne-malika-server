import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { shopSearchHitsDaily } from '../../db/schema';
import type { SearchHitDto } from './dto/search-hit.dto';

@Injectable()
export class SearchStatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async record(shopIds: number[], day: string, query: string): Promise<void> {
    if (shopIds.length === 0) return;

    await this.db
      .insert(shopSearchHitsDaily)
      .values(shopIds.map((shopId) => ({ shopId, day, query, shows: 1 })))
      .onConflictDoUpdate({
        target: [
          shopSearchHitsDaily.shopId,
          shopSearchHitsDaily.day,
          shopSearchHitsDaily.query,
        ],
        set: {
          shows: sql`${shopSearchHitsDaily.shows} + excluded.shows`,
        },
      });
  }

  topForShop(
    shopId: number,
    from: string,
    to: string,
    limit: number,
  ): Promise<SearchHitDto[]> {
    return this.db
      .select({
        query: shopSearchHitsDaily.query,
        shows: sql<number>`sum(${shopSearchHitsDaily.shows})::int`,
      })
      .from(shopSearchHitsDaily)
      .where(
        and(
          eq(shopSearchHitsDaily.shopId, shopId),
          gte(shopSearchHitsDaily.day, from),
          lte(shopSearchHitsDaily.day, to),
        ),
      )
      .groupBy(shopSearchHitsDaily.query)
      .orderBy(
        desc(sql`sum(${shopSearchHitsDaily.shows})`),
        asc(shopSearchHitsDaily.query),
      )
      .limit(limit);
  }

  async purgeOlderThan(boundary: string): Promise<number> {
    const result = await this.db
      .delete(shopSearchHitsDaily)
      .where(lt(shopSearchHitsDaily.day, boundary));

    return result.rowCount ?? 0;
  }
}
