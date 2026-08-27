import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.schema';
import { users } from './users.schema';
import {
  paymentProviderEnum,
  paymentStatusEnum,
  subscriptionPlanEnum,
} from './enums';

export interface SubscriptionPaymentMeta {
  serviceId?: string;
  signTime?: string;
  error?: number;
  errorNote?: string;
  reversed?: boolean;
  reversalNote?: string;
  needsManualReview?: boolean;
  refundedByProvider?: boolean;
  test?: boolean;
  invoiceId?: number;
  invoicePhone?: string;
  adminId?: number;
  note?: string;
}

export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    provider: paymentProviderEnum('provider').notNull().default('click'),

    plan: subscriptionPlanEnum('plan').notNull(),

    amount: numeric('amount', {
      precision: 14,
      scale: 2,
      mode: 'number',
    }).notNull(),

    status: paymentStatusEnum('status').notNull().default('prepared'),

    providerTransactionId: varchar('provider_transaction_id', { length: 64 }),

    providerPaymentId: varchar('provider_payment_id', { length: 64 }),

    providerPrepareId: varchar('provider_prepare_id', { length: 64 }),

    merchantBillingId: integer('merchant_billing_id')
      .notNull()
      .generatedByDefaultAsIdentity({
        name: 'subscription_payments_merchant_billing_id_seq',
        startWith: 100000,
      }),

    activatedFrom: timestamp('activated_from', { withTimezone: true }),
    activatedUntil: timestamp('activated_until', { withTimezone: true }),

    grantedCredits: bigint('granted_credits', { mode: 'number' }),
    burnedCredits: bigint('burned_credits', { mode: 'number' }),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    initiatorId: bigint('initiator_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    meta: jsonb('meta').$type<SubscriptionPaymentMeta>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    providerTxnIdx: uniqueIndex('subscription_payments_provider_txn_idx').on(
      table.provider,
      table.providerTransactionId,
    ),

    providerPaydocIdx: uniqueIndex(
      'subscription_payments_provider_paydoc_idx',
    ).on(table.provider, table.providerPaymentId),

    merchantBillingIdx: uniqueIndex(
      'subscription_payments_merchant_billing_idx',
    ).on(table.merchantBillingId),

    shopIdIdx: index('subscription_payments_shop_id_idx').on(
      table.shopId,
      sql`${table.createdAt} DESC`,
    ),

    statusIdx: index('subscription_payments_status_idx').on(
      table.status,
      table.createdAt,
    ),

    amountPositive: check(
      'subscription_payments_amount_positive',
      sql`${table.amount} > 0`,
    ),
  }),
);

export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
export type NewSubscriptionPayment = typeof subscriptionPayments.$inferInsert;
