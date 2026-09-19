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
import { sql } from 'drizzle-orm';
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

    categoryId: bigint('category_id', { mode: 'number' }).references(
      () => categories.id,
      { onDelete: 'set null' },
    ),

    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),

    photos: uuid('photos').array().notNull().default([]),

    price: numeric('price', { precision: 14, scale: 2 }),
    state: productStateEnum('state').notNull(),

    characteristics: jsonb('characteristics').$type<ProductCharacteristic[]>(),

    embedding: vector('embedding', { dimensions: 1536 }),

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
    createdAtIdx: index('product_cards_created_at_idx').on(
      table.createdAt.desc(),
    ),
    activeCreatedAtIdx: index('product_cards_active_created_at_idx')
      .on(table.createdAt.desc())
      .where(sql`${table.status} = 'active'`),
    shopActiveCreatedAtIdx: index('product_cards_shop_active_created_idx')
      .on(table.shopId, table.createdAt.desc())
      .where(sql`${table.status} = 'active'`),
    categoryActiveCreatedAtIdx: index(
      'product_cards_category_active_created_idx',
    )
      .on(table.categoryId, table.createdAt.desc())
      .where(sql`${table.status} = 'active'`),
  }),
);

export type ProductCard = typeof productCards.$inferSelect;
export type NewProductCard = typeof productCards.$inferInsert;
