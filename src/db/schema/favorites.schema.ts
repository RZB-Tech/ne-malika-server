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

/**
 * Избранные товары покупателя.
 *
 * Устроено как product_views: одна строка на пару «пользователь + товар»,
 * повторное добавление ничего не ломает благодаря уникальному индексу. Разница
 * в смысле — сюда товар кладут осознанно, поэтому дата не обновляется при
 * повторном нажатии: список отсортирован по тому, когда его добавили.
 *
 * Аноним держит избранное в localStorage, оно переезжает сюда после входа
 * (POST /me/favorites/sync).
 */
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
    // Цель та же, что у product_views: onConflict требует уникального
    // ограничения именно по этой паре.
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
