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
    /**
     * Именно `!== undefined`, а не проверка на истинность: `free=false` —
     * осмысленный запрос «покажи только те, за которые заплатили кредитами»,
     * и он обязан отличаться от «фильтра нет».
     */
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

  /**
   * Итоги за всё время: сколько запросов, во что они обошлись площадке и
   * сколько снято с магазинов.
   *
   * Расход разложен на три кармана, а не сложен в одну сумму, и до подписок
   * этого не требовалось: тогда всё, что не оплачено кредитами, было запросами
   * администратора и считалось единицами строк. Теперь появился третий случай —
   * автозаполнение по месячной норме или безлимиту тарифа, — у которого
   * `credits = 0` при непустом `shop_id`. Оставь мы одну сумму, себестоимость
   * таких запросов легла бы в неё при нулевой выручке рядом и прочиталась бы
   * как чистый убыток, хотя она уже оплачена абонплатой, которой в этой сводке
   * вообще нет.
   *
   * Отсюда деление:
   * - `usd` — только платные операции, то есть те, у которых есть магазин и
   *   с него списаны кредиты. Ровно эта сумма сравнима с `credits`, и только их
   *   разница и есть маржа на ИИ;
   * - `freeUsd` — операции подписчиков по норме и безлимиту. Расход настоящий,
   *   но покрыт подпиской, и сравнивать его с `credits` бессмысленно;
   * - `platformUsd` — запросы администратора (`shop_id IS NULL`): проверки,
   *   разбор жалоб, собственные карточки площадки. Выручки у них нет и не
   *   предполагалось.
   *
   * Три суммы в сложении дают весь расход у OpenRouter — то, что раньше
   * показывало одно поле `usd`. Складывать их обратно должен тот, кто хочет
   * именно расход; тот, кто хочет маржу, обязан этого не делать.
   *
   * `filter (where …)` вместо `sum(case when …)`: то же самое, но условие
   * читается как условие, а не как выражение внутри суммы.
   */
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
