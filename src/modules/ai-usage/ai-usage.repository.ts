import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
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
    if (query.q?.trim()) {
      const pattern = `%${query.q.trim()}%`;
      filters.push(
        or(
          ilike(users.fullname, pattern),
          ilike(users.telegramUsername, pattern),
          ilike(shops.name, pattern),
          ilike(aiUsage.model, pattern),
        )!,
      );
    }
    if (query.model?.trim()) {
      filters.push(eq(aiUsage.model, query.model.trim()));
    }
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
    if (query.platform !== undefined) {
      if (query.platform) {
        filters.push(isNull(aiUsage.shopId));
      } else {
        filters.push(isNotNull(aiUsage.shopId));
      }
    }
    if (query.period === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      filters.push(gte(aiUsage.createdAt, start));
    } else if (query.period === '7d') {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      filters.push(gte(aiUsage.createdAt, start));
    } else if (query.period === '30d') {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      filters.push(gte(aiUsage.createdAt, start));
    }
    if (query.from) {
      filters.push(gte(aiUsage.createdAt, new Date(query.from)));
    }
    if (query.to) {
      const toDate = new Date(query.to);
      toDate.setDate(toDate.getDate() + 1);
      filters.push(lt(aiUsage.createdAt, toDate));
    }

    const where = filters.length ? and(...filters) : undefined;

    let orderBy: SQL[] = [desc(aiUsage.createdAt)];
    if (query.sort === 'oldest') {
      orderBy = [asc(aiUsage.createdAt)];
    } else if (query.sort === 'cost_desc') {
      orderBy = [desc(aiUsage.usd), desc(aiUsage.createdAt)];
    } else if (query.sort === 'cost_asc') {
      orderBy = [asc(aiUsage.usd), desc(aiUsage.createdAt)];
    } else if (query.sort === 'credits_desc') {
      orderBy = [desc(aiUsage.credits), desc(aiUsage.createdAt)];
    }

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
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsage)
      .leftJoin(users, eq(aiUsage.userId, users.id))
      .leftJoin(shops, eq(aiUsage.shopId, shops.id))
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
