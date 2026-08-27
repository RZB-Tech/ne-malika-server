import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { shopSearchHitsDaily } from '../../db/schema';
import type { SearchHitDto } from './dto/search-hit.dto';

@Injectable()
export class SearchStatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Прибавить показ по запросу каждому из магазинов, попавших в выдачу.
   *
   * Одной вставкой на все магазины, а не циклом: поиск, совпавший с сотней
   * магазинов, дал бы сотню обращений к базе на одно нажатие клавиши. Инкремент
   * считает сама СУБД (`shows + excluded.shows`) — пара «прочитать, потом
   * записать» под одновременными поисками теряла бы часть показов. Всё как в
   * `ProductStatsRepository.record`, и по тем же причинам.
   *
   * Список магазинов обязан быть без повторов: `ON CONFLICT DO UPDATE` не умеет
   * трогать одну и ту же строку дважды в пределах одного запроса и отвечает на
   * это ошибкой. Повторов не бывает по построению — id приходят из
   * `SELECT DISTINCT`, — но требование записано здесь, потому что нарушить его
   * может только тот, кто вызовет метод иначе.
   */
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

  /**
   * Топ запросов магазина за период, от частого к редкому.
   *
   * `sum(...)::int` с приведением, а не голая сумма: над `integer` Postgres
   * считает в `bigint`, node-postgres отдаёт `int8` строкой, а парсеров типов
   * в `db.provider.ts` нет — без каста в DTO уехало бы `"37"` вместо `37`, и
   * клиент отсортировал бы числа как текст.
   *
   * Второй ключ сортировки — сам запрос: при равном числе показов порядок иначе
   * выбирала бы СУБД, и отчёт менялся бы от обновления страницы к обновлению.
   */
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

  /**
   * Убрать сутки старше границы. Граница приходит готовой датой, а не числом
   * дней: календарь площадки живёт в `product-stats.util.ts`, и репозиторию,
   * который сравнивает строки `YYYY-MM-DD`, знать про часовой пояс незачем.
   */
  async purgeOlderThan(boundary: string): Promise<number> {
    const result = await this.db
      .delete(shopSearchHitsDaily)
      .where(lt(shopSearchHitsDaily.day, boundary));

    return result.rowCount ?? 0;
  }
}
