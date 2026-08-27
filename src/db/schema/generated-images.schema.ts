import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';

export const generatedImages = pgTable(
  'generated_images',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),

    sourceKey: uuid('source_key').notNull(),

    key: uuid('key').notNull(),

    prompt: text('prompt').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceKeyIdx: index('generated_images_source_key_idx').on(
      table.sourceKey,
      sql`${table.createdAt} DESC`,
    ),
    userIdIdx: index('generated_images_user_id_idx').on(table.userId),
  }),
);

export type GeneratedImage = typeof generatedImages.$inferSelect;
export type NewGeneratedImage = typeof generatedImages.$inferInsert;
