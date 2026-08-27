import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { VISIBLE_PRODUCT } from '../../db/public-products';
import { productCards, productStatsDaily, shops } from '../../db/schema';

export interface StatsDelta {
  views: number;
  visitors: number;
  phoneClicks: number;
  telegramClicks: number;
  contactVisitors: number;
}

interface DailyRow {
  day: string;
  views: number;
  visitors: number;
  phoneClicks: number;
  telegramClicks: number;
  contactVisitors: number;
}

interface CountByDay {
  day: string;
  count: number;
}

interface TopProductRow {
  id: number;
  name: string;
  views: number;
  visitors: number;
  phoneClicks: number;
  telegramClicks: number;
  contactVisitors: number;
}

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

  async isPubliclyVisible(productCardId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: productCards.id })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(eq(productCards.id, productCardId), ...VISIBLE_PRODUCT))
      .limit(1);

    return row !== undefined;
  }

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
