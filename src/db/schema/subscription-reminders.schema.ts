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

/**
 * Что и кому уже отправлено об истечении подписки.
 *
 * Таблица — и есть механизм идемпотентности: право на отправку занимается
 * вставкой ДО обращения к Telegram, а не отметкой после (как в
 * `SellerNudgeService`), — иначе падение процесса на середине пачки повторило
 * бы рассылку всем, кто уже получил. Redis-claim для этого непригоден: он
 * fails open (`RedisService.claim` возвращает true без Redis и при ошибке).
 *
 * `expires_at` входит в ключ уникальности намеренно: продлил подписку — новый
 * срок, новое право на оба напоминания.
 */
export const subscriptionReminders = pgTable(
  'subscription_reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    stage: subscriptionReminderStageEnum('stage').notNull(),

    /**
     * Срок подписки на момент занятия права. Он же третий столбец ключа:
     * снимок, а не ссылка на `shops.subscription_until`, потому что срок
     * поменяется при продлении, а уже отправленное напоминание относилось
     * именно к прежнему сроку.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * Дошло ли до Telegram и на сколько устройств ушёл push. Пишутся после
     * отправки — в отличие от самой строки: право занимается заранее, а
     * результат известен только потом. Строка с обоими нулями означает, что
     * достучаться не удалось ни одним каналом, и это видно в разборе жалобы
     * «меня не предупредили».
     */
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
