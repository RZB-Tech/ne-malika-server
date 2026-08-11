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

/**
 * Подписка браузера на push.
 *
 * Принадлежит пользователю, а не устройству: рассылка выбирает адресатов по
 * роли, и подписку без владельца было бы некуда отнести. У одного человека их
 * несколько — ноутбук, телефон, второй браузер; каждая живёт своей жизнью и
 * умирает отдельно, когда браузер отзывает разрешение.
 *
 * `endpoint` — адрес, который выдаёт push-сервис браузера. Уникален глобально:
 * повторная подписка того же браузера должна обновлять запись, а не плодить
 * дубли, иначе один человек получит уведомление дважды.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    endpoint: text('endpoint').notNull(),

    /** Ключи шифрования из PushSubscription — без них сообщение не собрать. */
    p256dh: varchar('p256dh', { length: 255 }).notNull(),
    auth: varchar('auth', { length: 255 }).notNull(),

    /** Чтобы человек узнал свои устройства в списке подписок. */
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
