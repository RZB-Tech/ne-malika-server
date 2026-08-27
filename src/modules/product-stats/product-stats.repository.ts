import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { VISIBLE_PRODUCT } from '../../db/public-products';
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

/**
 * Строка топа товаров магазина за период.
 *
 * Конверсии здесь нет намеренно: это производная величина, и считается она в
 * сервисе тем же выражением, что и общая по магазину. Возвращать её из SQL
 * значило бы завести второе место, где живёт правило «делим на посещения, а не
 * на сумму контактов», — и однажды поправить только одно из двух.
 */
export interface TopProductRow {
  id: number;
  name: string;
  views: number;
  visitors: number;
  phoneClicks: number;
  telegramClicks: number;
  contactVisitors: number;
}

/**
 * Пять сумм суточного среза — одним выражением на оба магазинных отчёта.
 *
 * `coalesce(..., 0)::int` обязателен на каждой (V5): `sum()` поверх `integer`
 * даёт в Postgres `bigint`, у сырого SQL нет drizzle-маппера, и node-postgres
 * без парсеров типов вернул бы строку. Дальше эта «единица» сложилась бы с
 * соседней в «11», а не в 2 — ошибка, которая не падает, а тихо врёт продавцу
 * в отчёте.
 */
const SUMS = {
  views: sql<number>`coalesce(sum(${productStatsDaily.views}), 0)::int`,
  visitors: sql<number>`coalesce(sum(${productStatsDaily.visitors}), 0)::int`,
  phoneClicks: sql<number>`coalesce(sum(${productStatsDaily.phoneClicks}), 0)::int`,
  telegramClicks: sql<number>`coalesce(sum(${productStatsDaily.telegramClicks}), 0)::int`,
  contactVisitors: sql<number>`coalesce(sum(${productStatsDaily.contactVisitors}), 0)::int`,
} as const;

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
      .where(and(eq(productCards.id, productCardId), ...VISIBLE_PRODUCT))
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

  /**
   * Суточные строки всего магазина за отрезок, от старого к новому.
   *
   * Соединение с `product_cards` — единственный способ узнать магазин: в
   * суточном срезе лежит только товар. Товары в подсчёт входят все, включая
   * снятые с витрины и скрытые модератором: это уже случившаяся история
   * магазина, и прятать её от самого продавца незачем — иначе прошлый месяц
   * менялся бы задним числом каждый раз, когда он убирает проданный товар.
   *
   * Уникальные (`visitors`, `contactVisitors`) складываются по товарам, а
   * значит один посетитель, открывший три карточки магазина, посчитан трижды.
   * Настоящую уникальность по магазину дал бы только журнал посетителей, от
   * которого таблица сознательно ушла. Важно, что конверсия от этого не врёт:
   * оба её числа завышены одинаково, и внутри каждого товара
   * `contactVisitors <= visitors`, так что доля остаётся в пределах ста
   * процентов.
   */
  async shopDaily(
    shopId: number,
    from: string,
    to: string,
  ): Promise<DailyRow[]> {
    return this.db
      .select({ day: productStatsDaily.day, ...SUMS })
      .from(productStatsDaily)
      .innerJoin(
        productCards,
        eq(productStatsDaily.productCardId, productCards.id),
      )
      .where(
        and(
          eq(productCards.shopId, shopId),
          gte(productStatsDaily.day, from),
          lte(productStatsDaily.day, to),
        ),
      )
      .groupBy(productStatsDaily.day)
      .orderBy(asc(productStatsDaily.day));
  }

  /**
   * Товары магазина, которые за период смотрели чаще прочих.
   *
   * Порядок — просмотры по убыванию, а при равенстве по возрастанию id.
   * Второй ключ не украшение: без него Postgres волен вернуть строки с
   * одинаковым числом просмотров в любом порядке, и продавец, обновив
   * страницу, увидел бы, что его товары «поменялись местами» сами по себе.
   *
   * `limit` приходит из кода, а не от пользователя, — сколько строк влезает в
   * панель и в выгрузку, решает приложение.
   */
  async shopTopProducts(
    shopId: number,
    from: string,
    to: string,
    limit: number,
  ): Promise<TopProductRow[]> {
    return this.db
      .select({ id: productCards.id, name: productCards.name, ...SUMS })
      .from(productStatsDaily)
      .innerJoin(
        productCards,
        eq(productStatsDaily.productCardId, productCards.id),
      )
      .where(
        and(
          eq(productCards.shopId, shopId),
          gte(productStatsDaily.day, from),
          lte(productStatsDaily.day, to),
        ),
      )
      .groupBy(productCards.id, productCards.name)
      .orderBy(desc(SUMS.views), asc(productCards.id))
      .limit(limit);
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
