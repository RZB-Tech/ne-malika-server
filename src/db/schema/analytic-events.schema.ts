import { bigint, bigserial, index, jsonb, varchar } from 'drizzle-orm/pg-core';
import { pgTable, timestamp } from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';
import { analyticsEventTypeEnum } from './enums';

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    type: analyticsEventTypeEnum('type').notNull(),

    productCardId: bigint('product_card_id', { mode: 'number' }).references(
      () => productCards.id,
      { onDelete: 'cascade' },
    ),
    shopId: bigint('shop_id', { mode: 'number' }).references(() => shops.id, {
      onDelete: 'cascade',
    }),

    // используется для дедупликации повторных событий в коротком окне
    sessionId: varchar('session_id', { length: 128 }).notNull(),

    meta: jsonb('meta').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    typeCreatedAtIdx: index('analytics_events_type_created_at_idx').on(
      table.type,
      table.createdAt,
    ),
    shopIdIdx: index('analytics_events_shop_id_idx').on(table.shopId),
    productCardIdIdx: index('analytics_events_product_card_id_idx').on(
      table.productCardId,
    ),
    sessionIdIdx: index('analytics_events_session_id_idx').on(table.sessionId),
  }),
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
