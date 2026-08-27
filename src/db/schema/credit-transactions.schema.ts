import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { creditTxnKindEnum } from './enums';
import { shops } from './shops.schema';
import { users } from './users.schema';

export interface CreditTxnMeta {
  operation?: 'prompt' | 'description' | 'image' | 'autofill';
  model?: string;
  usd?: number;
  images?: number;
  paidUsd?: number;
  markup?: number;
  estimated?: boolean;
  fixed?: boolean;
  promo?: 'welcome' | 'welcome_topup' | 'subscription' | 'subscription_burn';
  fromSubscription?: number;
  plan?: 'start' | 'pro' | 'max';
  paymentId?: number;
  free?: 'quota' | 'unlimited';
}

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    authorId: bigint('author_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    kind: creditTxnKindEnum('kind').notNull(),

    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),

    subscriptionAfter: bigint('subscription_after', { mode: 'number' }),

    note: varchar('note', { length: 200 }),
    meta: jsonb('meta').$type<CreditTxnMeta>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    shopIdIdx: index('credit_transactions_shop_id_idx').on(
      table.shopId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type CreditTransaction = typeof creditTransactions.$inferSelect;
