import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.schema';

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    endpoint: text('endpoint').notNull(),

    p256dh: varchar('p256dh', { length: 255 }).notNull(),
    auth: varchar('auth', { length: 255 }).notNull(),

    userAgent: varchar('user_agent', { length: 300 }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    endpointIdx: uniqueIndex('push_subscriptions_endpoint_idx').on(
      table.endpoint,
    ),
    userIdIdx: index('push_subscriptions_user_id_idx').on(table.userId),
  }),
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
