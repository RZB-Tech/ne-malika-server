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
import { aiVerdictEnum, reviewStatusEnum } from './enums';

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

    productCardId: bigint('product_card_id', { mode: 'number' }).references(
      () => productCards.id,
      { onDelete: 'cascade' },
    ),

    rating: integer('rating').notNull(),

    text: text('text'),

    status: reviewStatusEnum('status').notNull().default('pending'),

    moderationNote: text('moderation_note'),

    aiVerdict: aiVerdictEnum('ai_verdict'),
    aiNote: text('ai_note'),
    aiCheckedAt: timestamp('ai_checked_at', { withTimezone: true }),

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

    statusIdx: index('reviews_status_idx').on(table.status, table.createdAt),

    ratingRange: check(
      'reviews_rating_range',
      sql`${table.rating} BETWEEN 1 AND 5`,
    ),
  }),
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
