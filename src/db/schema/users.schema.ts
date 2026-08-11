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
import { userRoleEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    telegramUsername: varchar('telegram_username', { length: 64 }),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    telegramChatId: bigint('telegram_chat_id', { mode: 'number' }),
    telegramPhoto: varchar('telegram_photo', { length: 1024 }),

    /**
     * Уведомления от бота. Выключается по команде /stop и автоматически, когда
     * Telegram отвечает 403: пользователь заблокировал бота, и продолжать
     * стучаться к нему бессмысленно.
     */
    telegramNotificationsEnabled: boolean('telegram_notifications_enabled')
      .notNull()
      .default(true),

    /** Когда продавцу последний раз напоминали добавить товар. */
    lastNudgeAt: timestamp('last_nudge_at', { withTimezone: true }),

    phoneNumber: varchar('phone_number', { length: 20 }),
    fullname: varchar('fullname', { length: 200 }).notNull(),

    // Регистрация даёт покупателя; продавцом пользователь становится сам,
    // когда создаёт магазин (ShopsService.createForSeller).
    role: userRoleEnum('role').notNull().default('user'),

    // Блокировка аккаунта. Отдельно от статуса магазина: упразднить
    // магазин мало — без блокировки владелец заведёт новый.
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
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
