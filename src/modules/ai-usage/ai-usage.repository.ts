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

  /**
   * Лента журнала с именами: без магазина и продавца строка отвечает только на
   * «сколько», а спрашивают у неё «кто».
   *
   * Соединения левые — и пользователь, и магазин могли быть удалены после
   * запроса, а сама запись о потраченных деньгах остаётся.
   */
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
    const where = filters.length ? and(...filters) : undefined;

    const data = await this.db
      .select({
        id: aiUsage.id,
        operation: aiUsage.operation,
        model: aiUsage.model,
        images: aiUsage.images,
        usd: aiUsage.usd,
        credits: aiUsage.credits,
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

  /**
   * Итоги за всё время: сколько запросов, сколько они стоили площадке и сколько
   * снято с магазинов. Разница между двумя суммами и есть заработок на ИИ —
   * ради неё сводка и нужна.
   */
  async totals() {
    const rows = await this.db
      .select({
        requests: sql<number>`count(*)::int`,
        images: sql<number>`coalesce(sum(${aiUsage.images}), 0)::int`,
        usd: sql<number>`coalesce(sum(${aiUsage.usd}), 0)::double precision`,
        credits: sql<number>`coalesce(sum(${aiUsage.credits}), 0)::bigint`,
      })
      .from(aiUsage);

    const row = rows[0];
    return {
      requests: row?.requests ?? 0,
      images: row?.images ?? 0,
      usd: Number(row?.usd ?? 0),
      credits: Number(row?.credits ?? 0),
    };
  }
}
