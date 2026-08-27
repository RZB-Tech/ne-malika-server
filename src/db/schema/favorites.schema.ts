import {
  bigint,
  bigserial,
  index,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { productCards } from './product-cards.schema';

export const favorites = pgTable(
  'favorites',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    productCardId: bigint('product_card_id', { mode: 'number' })
      .notNull()
      .references(() => productCards.id, { onDelete: 'cascade' }),

    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCardKey: uniqueIndex('favorites_user_card_key').on(
      table.userId,
      table.productCardId,
    ),
    userAddedAtIdx: index('favorites_user_added_at_idx').on(
      table.userId,
      table.addedAt.desc(),
    ),
  }),
);

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
