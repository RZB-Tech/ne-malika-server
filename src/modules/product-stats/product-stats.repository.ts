import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { productCards, productStatsDaily, shops } from '../../db/schema';

/** Сколько чего прибавить к суткам за одно событие. */
export interface StatsDelta {
  views: number;
  visitors: number;
  phoneClicks: number;
  telegramClicks: number;
  contactVisitors: number;
}

/** Строка суточного среза одного товара. */
export interface DailyRow {
  day: string;
  views: number;
  visitors: number;
  phoneClicks: number;
  telegramClicks: number;
  contactVisitors: number;
}

/** Срез активности площадки за сутки — по одному ряду на источник. */
export interface CountByDay {
  day: string;
  count: number;
}

@Injectable()
export class ProductStatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Товар виден постороннему, только если активен и он сам, и его магазин.
   *
   * Проверка обязательна: эндпоинт записи публичный, и без неё в статистику
   * можно было бы накачать просмотры скрытому модератором товару, а заодно
   * подтвердить перебором, что карточка с таким id вообще существует.
   */
  async isPubliclyVisible(productCardId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: productCards.id })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(
        and(
          eq(productCards.id, productCardId),
          eq(productCards.status, 'active'),
          eq(shops.status, 'active'),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /**
   * Прибавить событие к суткам товара.
   *
   * Инкремент делает сама СУБД (`views + excluded.views`), а не приложение:
   * пара «прочитать, потом записать» под одновременными запросами теряла бы
   * часть просмотров. Первичный ключ по паре «товар + день» гарантирует, что
   * строка на сутки ровно одна.
   */
  async record(
    productCardId: number,
    day: string,
    delta: StatsDelta,
  ): Promise<void> {
    await this.db
      .insert(productStatsDaily)
      .values({ productCardId, day, ...delta })
      .onConflictDoUpdate({
        target: [productStatsDaily.productCardId, productStatsDaily.day],
        set: {
          views: sql`${productStatsDaily.views} + excluded.views`,
          visitors: sql`${productStatsDaily.visitors} + excluded.visitors`,
          phoneClicks: sql`${productStatsDaily.phoneClicks} + excluded.phone_clicks`,
          telegramClicks: sql`${productStatsDaily.telegramClicks} + excluded.telegram_clicks`,
          contactVisitors: sql`${productStatsDaily.contactVisitors} + excluded.contact_visitors`,
        },
      });
  }

  /** Суточные строки одного товара за отрезок, от старого к новому. */
  async findRange(
    productCardId: number,
    from: string,
    to: string,
  ): Promise<DailyRow[]> {
    return this.db
      .select({
        day: productStatsDaily.day,
        views: productStatsDaily.views,
        visitors: productStatsDaily.visitors,
        phoneClicks: productStatsDaily.phoneClicks,
        telegramClicks: productStatsDaily.telegramClicks,
        contactVisitors: productStatsDaily.contactVisitors,
      })
      .from(productStatsDaily)
      .where(
        and(
          eq(productStatsDaily.productCardId, productCardId),
          gte(productStatsDaily.day, from),
          lte(productStatsDaily.day, to),
        ),
      )
      .orderBy(asc(productStatsDaily.day));
  }

  /** Просмотры и контакты поперёк всех товаров, по суткам. */
  async viewsByDay(
    from: string,
    to: string,
  ): Promise<{ day: string; views: number; contacts: number }[]> {
    const rows = await this.db
      .select({
        day: productStatsDaily.day,
        views: sql<string>`sum(${productStatsDaily.views})`,
        contacts: sql<string>`sum(${productStatsDaily.phoneClicks} + ${productStatsDaily.telegramClicks})`,
      })
      .from(productStatsDaily)
      .where(
        and(gte(productStatsDaily.day, from), lte(productStatsDaily.day, to)),
      )
      .groupBy(productStatsDaily.day);

    return rows.map((r) => ({
      day: r.day,
      views: Number(r.views ?? 0),
      contacts: Number(r.contacts ?? 0),
    }));
  }

  /**
   * Сколько строк таблицы создано в каждые сутки.
   *
   * `created_at` хранится в UTC, а сутки нужны местные — иначе всё, что завели
   * вечером по Ташкенту, уехало бы в следующий столбик графика. Приведение
   * делается в СУБД: тянуть все строки в приложение ради группировки незачем.
   *
   * Считает только по трём известным таблицам — имя приходит не от пользователя,
   * а из вызывающего кода, поэтому подстановка идентификатора безопасна.
   */
  private async createdByDay(
    table: 'product_cards' | 'shops' | 'users',
    from: string,
    to: string,
  ): Promise<CountByDay[]> {
    const local = sql.raw(`(created_at AT TIME ZONE 'Asia/Tashkent')::date`);

    const rows = await this.db.execute<{ day: string; count: string }>(
      sql`select ${local} as day, count(*)::text as count
          from ${sql.raw(table)}
          where ${local} between ${from} and ${to}
          group by 1`,
    );

    return (rows.rows ?? []).map((r) => ({
      day: String(r.day).slice(0, 10),
      count: Number(r.count ?? 0),
    }));
  }

  productsByDay(from: string, to: string) {
    return this.createdByDay('product_cards', from, to);
  }

  shopsByDay(from: string, to: string) {
    return this.createdByDay('shops', from, to);
  }

  usersByDay(from: string, to: string) {
    return this.createdByDay('users', from, to);
  }
}
