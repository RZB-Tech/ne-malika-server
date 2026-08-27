import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { moderationStatusEnum } from './enums';
import { shops } from './shops.schema';
import { users } from './users.schema';

export const banners = pgTable(
  'banners',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    title: varchar('title', { length: 200 }).notNull(),

    photoRu: uuid('photo_ru').notNull(),
    photoUzLatn: uuid('photo_uz_latn').notNull(),
    photoUzCyrl: uuid('photo_uz_cyrl').notNull(),

    linkUrl: varchar('link_url', { length: 500 }),

    isActive: boolean('is_active').notNull().default(true),

    sortOrder: integer('sort_order').notNull().default(0),

    shopId: bigint('shop_id', { mode: 'number' }).references(() => shops.id, {
      onDelete: 'cascade',
    }),

    status: moderationStatusEnum('status').notNull().default('approved'),

    rejectReason: text('reject_reason'),

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
    publicIdx: index('banners_public_idx')
      .on(table.sortOrder, table.id)
      .where(sql`${table.isActive} AND ${table.status} = 'approved'`),

    shopStatusIdx: index('banners_shop_status_idx').on(
      table.shopId,
      table.status,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type Banner = typeof banners.$inferSelect;
export type NewBanner = typeof banners.$inferInsert;
