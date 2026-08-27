import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { productCards } from './product-cards.schema';

export const productStatsDaily = pgTable(
  'product_stats_daily',
  {
    productCardId: bigint('product_card_id', { mode: 'number' })
      .notNull()
      .references(() => productCards.id, { onDelete: 'cascade' }),

    day: date('day').notNull(),

    views: integer('views').notNull().default(0),

    visitors: integer('visitors').notNull().default(0),

    phoneClicks: integer('phone_clicks').notNull().default(0),

    telegramClicks: integer('telegram_clicks').notNull().default(0),

    contactVisitors: integer('contact_visitors').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productCardId, table.day] }),

    dayIdx: index('product_stats_daily_day_idx').on(table.day),
  }),
);
