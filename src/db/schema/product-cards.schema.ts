import {
  bigint,
  bigserial,
  index,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';
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

    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),

    photos: uuid('photos').array().notNull().default([]),

    price: numeric('price', { precision: 14, scale: 2 }).notNull(),
    state: productStateEnum('state').notNull(),

    // Новое поле — произвольные пользовательские характеристики
    characteristics: jsonb('characteristics').$type<ProductCharacteristic[]>(),

    embedding: vector('embedding', { dimensions: 1536 }),

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
  }),
);

export type ProductCard = typeof productCards.$inferSelect;
export type NewProductCard = typeof productCards.$inferInsert;
