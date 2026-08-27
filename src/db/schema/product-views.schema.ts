import {
  bigint,
  bigserial,
  index,
  integer,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { productCards } from './product-cards.schema';

export const productViews = pgTable(
  'product_views',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    productCardId: bigint('product_card_id', { mode: 'number' })
      .notNull()
      .references(() => productCards.id, { onDelete: 'cascade' }),

    viewCount: integer('view_count').notNull().default(1),

    viewedAt: timestamp('viewed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCardKey: uniqueIndex('product_views_user_card_key').on(
      table.userId,
      table.productCardId,
    ),
    userViewedAtIdx: index('product_views_user_viewed_at_idx').on(
      table.userId,
      table.viewedAt.desc(),
    ),
  }),
);
