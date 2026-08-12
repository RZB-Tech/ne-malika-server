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

    checks: jsonb('checks').$type<Record<string, unknown>>().notNull(),

    summary: text('summary'),

    /**
     * Отметка «человек разобрался». Проверка со сбоем или вердиктом fail висит
     * в очереди модерации, пока администратор её не одобрит или не отправит
     * на повтор — сам по себе статус товара для этого не годится: при сбое
     * сервиса товар не публикуется, пока его не проверит администратор.
     */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

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
