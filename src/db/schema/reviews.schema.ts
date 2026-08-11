import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';
import { reviewStatusEnum } from './enums';

/**
 * Отзывы о товарах и магазинах.
 *
 * Одна таблица на оба случая, а не две: поля совпадают полностью, модерация
 * одна и та же, и админской очереди удобнее видеть общий список. Различает их
 * `product_card_id`: пусто — отзыв о самом магазине.
 *
 * `shop_id` заполнен всегда, даже у отзыва о товаре. Так рейтинг продавца
 * считается одним запросом, без похода в product_cards, и переживает удаление
 * товара — оценка магазина от этого не должна прыгать.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    authorId: bigint('author_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    /** Пусто — отзыв о магазине целиком. */
    productCardId: bigint('product_card_id', { mode: 'number' }).references(
      () => productCards.id,
      { onDelete: 'cascade' },
    ),

    rating: integer('rating').notNull(),

    /** Текст необязателен: оценка звёздами без слов — тоже отзыв. */
    text: text('text'),

    status: reviewStatusEnum('status').notNull().default('pending'),

    /** Причина отклонения — её видит автор, поэтому пишется человеческим языком. */
    moderationNote: text('moderation_note'),

    /** Кто решил. `set null`: увольнение администратора не должно стирать отзыв. */
    moderatedBy: bigint('moderated_by', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /**
     * Один отзыв на товар от одного человека. Ограничение частичное, потому
     * что в SQL NULL не равен NULL: без условия обычный уникальный индекс
     * пропустил бы сколько угодно отзывов о магазине от одного автора.
     */
    authorProductIdx: uniqueIndex('reviews_author_product_idx')
      .on(table.authorId, table.productCardId)
      .where(sql`${table.productCardId} IS NOT NULL`),

    authorShopIdx: uniqueIndex('reviews_author_shop_idx')
      .on(table.authorId, table.shopId)
      .where(sql`${table.productCardId} IS NULL`),

    productIdx: index('reviews_product_idx').on(
      table.productCardId,
      table.status,
    ),
    shopIdx: index('reviews_shop_idx').on(table.shopId, table.status),

    /** Очередь модерации: свежие непроверенные сверху. */
    statusIdx: index('reviews_status_idx').on(table.status, table.createdAt),

    /**
     * Проверка в базе, а не только в DTO: оценку пишет и модерация, и будущие
     * пересчёты, и ноль звёзд из-за случайной правки испортил бы весь рейтинг
     * магазина молча.
     */
    ratingRange: check(
      'reviews_rating_range',
      sql`${table.rating} BETWEEN 1 AND 5`,
    ),
  }),
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
