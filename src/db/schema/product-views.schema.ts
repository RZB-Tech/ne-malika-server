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

/**
 * История просмотров товаров покупателем.
 *
 * Одна строка на пару «пользователь + товар», а не журнал событий: кабинету
 * нужен список «что я смотрел», и повторный заход на ту же карточку должен
 * поднимать её наверх, а не плодить дубликаты. Поэтому запись идёт апсертом по
 * уникальному индексу, а число заходов копится в `viewCount`.
 *
 * Аноним сюда не попадает — его история живёт в localStorage и переносится
 * сюда одним запросом после входа (POST /me/product-views/sync).
 */
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

    /** Сколько раз пользователь открывал карточку. */
    viewCount: integer('view_count').notNull().default(1),

    /** Последний просмотр — по нему сортируется выдача кабинета. */
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

export type ProductView = typeof productViews.$inferSelect;
export type NewProductView = typeof productViews.$inferInsert;
