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

    productCardId: bigint('product_card_id', { mode: 'number' }).references(
      () => productCards.id,
      { onDelete: 'set null' },
    ),

    productName: varchar('product_name', { length: 200 }),

    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageText: varchar('last_message_text', { length: 200 }),

    buyerUnread: integer('buyer_unread').notNull().default(0),
    sellerUnread: integer('seller_unread').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    buyerProductIdx: uniqueIndex('chats_buyer_product_idx')
      .on(table.buyerId, table.productCardId)
      .where(sql`${table.productCardId} IS NOT NULL`),

    buyerShopIdx: uniqueIndex('chats_buyer_shop_idx')
      .on(table.buyerId, table.shopId)
      .where(sql`${table.productName} IS NULL`),

    shopIdx: index('chats_shop_idx').on(table.shopId, table.lastMessageAt),
    buyerIdx: index('chats_buyer_idx').on(table.buyerId, table.lastMessageAt),
  }),
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    chatId: bigint('chat_id', { mode: 'number' })
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),

    senderId: bigint('sender_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    kind: chatMessageKindEnum('kind').notNull(),

    text: text('text').notNull(),

    readAt: timestamp('read_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatIdx: index('chat_messages_chat_idx').on(table.chatId, table.createdAt),
  }),
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
