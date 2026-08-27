import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  varchar,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';

export const shopSearchHitsDaily = pgTable(
  'shop_search_hits_daily',
  {
    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    day: date('day').notNull(),

    query: varchar('query', { length: 100 }).notNull(),

    shows: integer('shows').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.shopId, table.day, table.query] }),

    shopDayIdx: index('shop_search_hits_shop_day_idx').on(
      table.shopId,
      table.day,
    ),
  }),
);

export type ShopSearchHitsDaily = typeof shopSearchHitsDaily.$inferSelect;
export type NewShopSearchHitsDaily = typeof shopSearchHitsDaily.$inferInsert;
