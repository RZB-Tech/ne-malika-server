import {
  bigint,
  bigserial,
  index,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pgTable, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';
import { users } from './users.schema';

export const reports = pgTable(
  'reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    context: text('context').notNull(),

    // Nullable только ради жалоб, поданных до введения авторства: приписать их
    // некому. Сервис всегда проставляет автора, а частичные уникальные индексы
    // ниже отсеивают старые строки, чтобы они не мешали дедупликации.
    authorId: bigint('author_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'cascade' },
    ),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    productCardId: bigint('product_card_id', { mode: 'number' }).references(
      () => productCards.id,
      { onDelete: 'cascade' },
    ),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    shopIdIdx: index('reports_shop_id_idx').on(table.shopId),
    authorIdx: index('reports_author_idx').on(table.authorId),

    // Одна жалоба на товар и одна на магазин от одного человека. Разные
    // магазины одного владельца не складываются в обход: цель у жалобы одна.
    authorProductIdx: uniqueIndex('reports_author_product_idx')
      .on(table.authorId, table.productCardId)
      .where(
        sql`${table.productCardId} IS NOT NULL AND ${table.authorId} IS NOT NULL`,
      ),

    authorShopIdx: uniqueIndex('reports_author_shop_idx')
      .on(table.authorId, table.shopId)
      .where(
        sql`${table.productCardId} IS NULL AND ${table.authorId} IS NOT NULL`,
      ),
  }),
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
