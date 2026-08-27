import {
  bigint,
  bigserial,
  boolean,
  index,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { userRoleEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    telegramUsername: varchar('telegram_username', { length: 64 }),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    telegramChatId: bigint('telegram_chat_id', { mode: 'number' }),
    telegramPhoto: varchar('telegram_photo', { length: 1024 }),

    telegramNotificationsEnabled: boolean('telegram_notifications_enabled')
      .notNull()
      .default(true),

    lastNudgeAt: timestamp('last_nudge_at', { withTimezone: true }),

    phoneNumber: varchar('phone_number', { length: 20 }),
    fullname: varchar('fullname', { length: 200 }).notNull(),

    role: userRoleEnum('role').notNull().default('user'),

    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockReason: text('block_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    telegramIdIdx: index('users_telegram_id_idx').on(table.telegramId),

    telegramChatIdIdx: index('users_telegram_chat_id_idx')
      .on(table.telegramChatId)
      .where(sql`${table.telegramChatId} IS NOT NULL`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
