import { bigint, bigserial, index, text } from 'drizzle-orm/pg-core';
import { pgTable, timestamp } from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';

export const reports = pgTable(
  'reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    context: text('context').notNull(),

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
  }),
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
