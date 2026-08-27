import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.schema';
import { users } from './users.schema';

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),

    shopId: bigint('shop_id', { mode: 'number' }).references(() => shops.id, {
      onDelete: 'set null',
    }),

    operation: varchar('operation', { length: 20 }).notNull(),

    model: varchar('model', { length: 120 }),

    images: integer('images').notNull().default(0),

    usd: doublePrecision('usd'),

    credits: bigint('credits', { mode: 'number' }).notNull().default(0),

    free: boolean('free').notNull().default(false),

    estimated: boolean('estimated').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('ai_usage_created_at_idx').on(
      sql`${table.createdAt} DESC`,
    ),
    shopIdIdx: index('ai_usage_shop_id_idx').on(
      table.shopId,
      sql`${table.createdAt} DESC`,
    ),
    userIdIdx: index('ai_usage_user_id_idx').on(
      table.userId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type NewAiUsage = typeof aiUsage.$inferInsert;
