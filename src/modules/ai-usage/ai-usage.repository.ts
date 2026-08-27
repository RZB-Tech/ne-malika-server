import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { aiUsage, shops, users, type NewAiUsage } from '../../db/schema';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import { FindAiUsageQueryDto } from './dto/find-ai-usage-query.dto';

@Injectable()
export class AiUsageRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  record(entry: NewAiUsage): Promise<unknown> {
    return this.db.insert(aiUsage).values(entry);
  }

  async findAll(query: FindAiUsageQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const filters: SQL[] = [];
    if (query.shopId !== undefined) {
      filters.push(eq(aiUsage.shopId, query.shopId));
    }
    if (query.userId !== undefined) {
      filters.push(eq(aiUsage.userId, query.userId));
    }
    if (query.operation !== undefined) {
      filters.push(eq(aiUsage.operation, query.operation));
    }
    if (query.free !== undefined) {
      filters.push(eq(aiUsage.free, query.free));
    }
    const where = filters.length ? and(...filters) : undefined;

    const data = await this.db
      .select({
        id: aiUsage.id,
        operation: aiUsage.operation,
        model: aiUsage.model,
        images: aiUsage.images,
        usd: aiUsage.usd,
        credits: aiUsage.credits,
        free: aiUsage.free,
        estimated: aiUsage.estimated,
        createdAt: aiUsage.createdAt,
        userId: aiUsage.userId,
        userName: users.fullname,
        userUsername: users.telegramUsername,
        userRole: users.role,
        shopId: aiUsage.shopId,
        shopName: shops.name,
      })
      .from(aiUsage)
      .leftJoin(users, eq(aiUsage.userId, users.id))
      .leftJoin(shops, eq(aiUsage.shopId, shops.id))
      .where(where)
      .orderBy(desc(aiUsage.createdAt))
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(where)
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }

  async totals() {
    const paid = sql`${aiUsage.shopId} is not null and not ${aiUsage.free}`;
    const rows = await this.db
      .select({
        requests: sql<number>`count(*)::int`,
        images: sql<number>`coalesce(sum(${aiUsage.images}), 0)::int`,
        usd: sql<number>`coalesce(sum(${aiUsage.usd}) filter (where ${paid}), 0)::double precision`,
        credits: sql<number>`coalesce(sum(${aiUsage.credits}), 0)::bigint`,
        freeRequests: sql<number>`(count(*) filter (where ${aiUsage.free}))::int`,
        freeUsd: sql<number>`coalesce(sum(${aiUsage.usd}) filter (where ${aiUsage.free}), 0)::double precision`,
        platformRequests: sql<number>`(count(*) filter (where ${aiUsage.shopId} is null))::int`,
        platformUsd: sql<number>`coalesce(sum(${aiUsage.usd}) filter (where ${aiUsage.shopId} is null), 0)::double precision`,
      })
      .from(aiUsage);

    const row = rows[0];
    return {
      requests: row?.requests ?? 0,
      images: row?.images ?? 0,
      usd: Number(row?.usd ?? 0),
      credits: Number(row?.credits ?? 0),
      freeRequests: row?.freeRequests ?? 0,
      freeUsd: Number(row?.freeUsd ?? 0),
      platformRequests: row?.platformRequests ?? 0,
      platformUsd: Number(row?.platformUsd ?? 0),
    };
  }
}
