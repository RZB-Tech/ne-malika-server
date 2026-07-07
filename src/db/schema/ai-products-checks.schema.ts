import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  text,
  varchar,
} from 'drizzle-orm/pg-core';
import { pgTable, timestamp } from 'drizzle-orm/pg-core';
import { productCards } from './product-cards.schema';
import { aiVerdictEnum } from './enums';

export const aiProductChecks = pgTable(
  'ai_product_checks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    productCardId: bigint('product_card_id', { mode: 'number' })
      .notNull()
      .references(() => productCards.id, { onDelete: 'cascade' }),

    verdict: aiVerdictEnum('verdict').notNull(),

    // { description: {...}, dataConsistency: {...}, photos: {...}, photoMatch: {...} }
    checks: jsonb('checks').$type<Record<string, unknown>>().notNull(),

    summary: text('summary'),

    model: varchar('model', { length: 100 }).notNull(),
    tokensUsed: integer('tokens_used'),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    productCardIdIdx: index('ai_product_checks_product_card_id_idx').on(
      table.productCardId,
    ),
  }),
);

export type AiProductCheck = typeof aiProductChecks.$inferSelect;
export type NewAiProductCheck = typeof aiProductChecks.$inferInsert;
