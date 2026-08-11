import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';
import { categories } from './categories.schema';
import { entityStatusEnum, productStateEnum } from './enums';
import { vector } from './vector-type';

export interface ProductCharacteristic {
  key: string;
  value: string;
}

export const productCards = pgTable(
  'product_cards',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    /**
     * Категория каталога. Nullable: товары, заведённые до появления категорий,
     * остаются без неё, а удаление категории не должно уносить чужой товар.
     */
    categoryId: bigint('category_id', { mode: 'number' }).references(
      () => categories.id,
      { onDelete: 'set null' },
    ),

    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),

    photos: uuid('photos').array().notNull().default([]),

    /**
     * Пусто — «цена договорная». Отдельного флага нет намеренно: цена либо
     * названа, либо нет, и два поля позволили бы им разойтись — «договорная»
     * с числом рядом.
     */
    price: numeric('price', { precision: 14, scale: 2 }),
    state: productStateEnum('state').notNull(),

    // Новое поле — произвольные пользовательские характеристики
    characteristics: jsonb('characteristics').$type<ProductCharacteristic[]>(),

    embedding: vector('embedding', { dimensions: 1536 }),

    /**
     * Оценка по опубликованным отзывам. Хранится готовой, а не считается на
     * лету: она нужна каждой плитке каталога, и подзапрос на строку выдачи
     * превратил бы список из двадцати товаров в двадцать агрегатов.
     * Пересчитывается целиком при каждом изменении статуса отзыва — накопление
     * приращениями рано или поздно разъезжается с фактом.
     */
    ratingAvg: doublePrecision('rating_avg').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),

    status: entityStatusEnum('status').notNull().default('active'),
    abolishReason: text('abolish_reason'),
    abolishedAt: timestamp('abolished_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    shopIdIdx: index('product_cards_shop_id_idx').on(table.shopId),
    statusIdx: index('product_cards_status_idx').on(table.status),
    categoryIdIdx: index('product_cards_category_id_idx').on(table.categoryId),
  }),
);

export type ProductCard = typeof productCards.$inferSelect;
export type NewProductCard = typeof productCards.$inferInsert;
