import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';
import { chatMessageKindEnum } from './enums';

/**
 * Переписка покупателя с магазином.
 *
 * Разговор привязан к товару: «а этот в наличии?» — вопрос про конкретную
 * карточку, и в кабинете продавца он должен лежать рядом с ней, а не в общей
 * куче. Написать можно и магазину целиком — тогда `product_card_id` пуст.
 *
 * `shop_id`, а не «второй участник»: магазин может сменить владельца, а
 * переписка остаётся перепиской с магазином. Кто именно отвечает, видно по
 * автору сообщения.
 */
export const chats = pgTable(
  'chats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    buyerId: bigint('buyer_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * О чём разговор. `set null`, а не каскад: товар продан и снят, а
     * договорённости из переписки обеим сторонам ещё нужны.
     */
    productCardId: bigint('product_card_id', { mode: 'number' }).references(
      () => productCards.id,
      { onDelete: 'set null' },
    ),

    /**
     * Название товара на момент начала разговора. Снимок, а не соединение с
     * карточкой: после снятия товара ссылка обнуляется, и без снимка обе
     * стороны получили бы переписку неизвестно о чём. Заодно это единственный
     * признак, отличающий разговор о товаре от разговора с магазином, —
     * `product_card_id` для этого не годится, он исчезает вместе с товаром.
     */
    productName: varchar('product_name', { length: 200 }),

    /**
     * Последнее сообщение прямо в чате — список переписок иначе тянул бы
     * подзапрос на каждую строку ради одной строчки текста под именем.
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageText: varchar('last_message_text', { length: 200 }),

    /**
     * Непрочитанное — счётчиками, а не пересчётом по таблице сообщений: значок
     * над «Сообщениями» запрашивают на каждой странице, и COUNT по чужим
     * сообщениям в каждом чате обходился бы дороже самого чата.
     */
    buyerUnread: integer('buyer_unread').notNull().default(0),
    sellerUnread: integer('seller_unread').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /**
     * Один разговор на товар. Частичный индекс, потому что в SQL NULL не равен
     * NULL: обычный уникальный пропустил бы сколько угодно чатов с магазином
     * от одного покупателя.
     */
    buyerProductIdx: uniqueIndex('chats_buyer_product_idx')
      .on(table.buyerId, table.productCardId)
      .where(sql`${table.productCardId} IS NOT NULL`),

    /**
     * И один разговор «с магазином вообще». Условие по названию товара, а не по
     * ссылке на него: при снятии товара ссылка обнуляется, и разговор о товаре
     * столкнулся бы с уже существующим разговором о магазине — удаление товара
     * падало бы с нарушением уникальности.
     */
    buyerShopIdx: uniqueIndex('chats_buyer_shop_idx')
      .on(table.buyerId, table.shopId)
      .where(sql`${table.productName} IS NULL`),

    /** Списки обеих сторон: свежие разговоры сверху. */
    shopIdx: index('chats_shop_idx').on(table.shopId, table.lastMessageAt),
    buyerIdx: index('chats_buyer_idx').on(table.buyerId, table.lastMessageAt),
  }),
);

/**
 * Сообщения переписки.
 *
 * `kind` говорит, чей это голос, и не выводится из `sender_id`: ответ, который
 * со временем напишет за продавца ИИ, уйдёт от имени магазина, но покупатель
 * должен видеть, что отвечал не человек. Отсюда же и `sender_id` необязателен —
 * у автоответа автора-человека нет.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    chatId: bigint('chat_id', { mode: 'number' })
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),

    /** Пусто — писал не человек: автоответ или системное сообщение. */
    senderId: bigint('sender_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    kind: chatMessageKindEnum('kind').notNull(),

    text: text('text').notNull(),

    /** Когда собеседник открыл переписку и увидел это сообщение. */
    readAt: timestamp('read_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /** Лента одного разговора — по порядку. */
    chatIdx: index('chat_messages_chat_idx').on(table.chatId, table.createdAt),
  }),
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
