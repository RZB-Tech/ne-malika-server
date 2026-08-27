import {
  bigint,
  bigserial,
  boolean,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';
import { subscriptionReminderStageEnum } from './enums';

export const subscriptionReminders = pgTable(
  'subscription_reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    stage: subscriptionReminderStageEnum('stage').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    telegramDelivered: boolean('telegram_delivered').notNull().default(false),
    pushDelivered: integer('push_delivered').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    onceIdx: uniqueIndex('subscription_reminders_once_idx').on(
      table.shopId,
      table.stage,
      table.expiresAt,
    ),
  }),
);

export type SubscriptionReminder = typeof subscriptionReminders.$inferSelect;
export type NewSubscriptionReminder = typeof subscriptionReminders.$inferInsert;
