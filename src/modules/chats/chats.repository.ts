import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import {
  type Chat,
  type ChatMessage,
  chatMessages,
  chats,
  productCards,
  shops,
  users,
} from '../../db/schema';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Строка списка переписок. Одна и та же для обеих сторон: покупатель смотрит на
 * магазин, продавец — на покупателя, но данные нужны те же самые, и городить
 * две проекции ради разного порядка полей незачем.
 *
 * `unread` подставляет сервис: чей счётчик брать, зависит от стороны.
 */
const CHAT_FIELDS = {
  id: chats.id,
  shopId: chats.shopId,
  shopName: shops.name,
  shopPhoto: shops.photo,
  buyerId: chats.buyerId,
  buyerName: users.fullname,
  buyerPhoto: users.telegramPhoto,
  productCardId: chats.productCardId,
  /** Из чата, а не из карточки: у снятого товара названия уже не спросишь. */
  productName: chats.productName,
  productPhotos: productCards.photos,
  lastMessageText: chats.lastMessageText,
  lastMessageAt: chats.lastMessageAt,
  buyerUnread: chats.buyerUnread,
  sellerUnread: chats.sellerUnread,
};

const MESSAGE_FIELDS = {
  id: chatMessages.id,
  kind: chatMessages.kind,
  text: chatMessages.text,
  readAt: chatMessages.readAt,
  createdAt: chatMessages.createdAt,
};

const COUNT = { count: sql<number>`count(*)::int` };

/** Столько текста показываем в списке под именем собеседника. */
const PREVIEW_MAX = 200;

export type ChatRow = Awaited<
  ReturnType<ChatsRepository['findForBuyer']>
>['data'][number];

export type ChatMessageRow = Awaited<
  ReturnType<ChatsRepository['listMessages']>
>['data'][number];

/** Чат вместе с владельцем магазина — по нему и проверяется доступ. */
export interface ChatWithOwner extends Chat {
  ownerId: number;
  shopName: string;
}

@Injectable()
export class ChatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Чат и владелец его магазина одним запросом: без владельца нельзя ни
   * пустить продавца в переписку, ни отказать постороннему.
   */
  findById(id: number): Promise<ChatWithOwner | undefined> {
    return this.db
      .select({
        chat: chats,
        ownerId: shops.owner,
        shopName: shops.name,
      })
      .from(chats)
      .innerJoin(shops, eq(shops.id, chats.shopId))
      .where(eq(chats.id, id))
      .then((rows) =>
        rows[0]
          ? {
              ...rows[0].chat,
              ownerId: rows[0].ownerId,
              shopName: rows[0].shopName,
            }
          : undefined,
      );
  }

  /**
   * Уже начатый разговор о том же товаре — или разговор с магазином, если
   * товара нет. Разговор с магазином узнаём по пустому названию товара, а не по
   * пустой ссылке: у переписки о снятом товаре ссылка тоже пуста, но подставлять
   * её вместо общего разговора нельзя.
   */
  findExisting(
    buyerId: number,
    shopId: number,
    productCardId: number | null,
  ): Promise<Chat | undefined> {
    return this.db.query.chats.findFirst({
      where: and(
        eq(chats.buyerId, buyerId),
        eq(chats.shopId, shopId),
        productCardId === null
          ? isNull(chats.productName)
          : eq(chats.productCardId, productCardId),
      ),
    });
  }

  create(data: {
    buyerId: number;
    shopId: number;
    productCardId: number | null;
    productName: string | null;
  }): Promise<Chat> {
    return this.db
      .insert(chats)
      .values(data)
      .returning()
      .then((rows) => rows[0]);
  }

  findForBuyer(buyerId: number, query: PaginationQueryDto) {
    return this.list(eq(chats.buyerId, buyerId), query);
  }

  /** Переписки магазина. Магазин ищем по владельцу — свой у продавца один. */
  findForShop(shopId: number, query: PaginationQueryDto) {
    return this.list(eq(chats.shopId, shopId), query);
  }

  async listMessages(chatId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);
    const where = eq(chatMessages.chatId, chatId);

    const [data, totalRows] = await Promise.all([
      this.db
        .select(MESSAGE_FIELDS)
        .from(chatMessages)
        .where(where)
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(limit)
        .offset(offset),
      this.db.select(COUNT).from(chatMessages).where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /**
   * Сообщение и обновление шапки чата — одной транзакцией: список переписок
   * читает и то и другое, и разъехавшиеся «последнее сообщение» со счётчиком
   * непрочитанного выглядят поломкой.
   */
  addMessage(data: {
    chatId: number;
    senderId: number | null;
    kind: 'buyer' | 'seller' | 'ai';
    text: string;
  }): Promise<ChatMessage> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx.insert(chatMessages).values(data).returning();

      const forBuyer = data.kind !== 'buyer';

      await tx
        .update(chats)
        .set({
          lastMessageAt: message.createdAt,
          lastMessageText: data.text.slice(0, PREVIEW_MAX),
          buyerUnread: forBuyer
            ? sql`${chats.buyerUnread} + 1`
            : chats.buyerUnread,
          sellerUnread: forBuyer
            ? chats.sellerUnread
            : sql`${chats.sellerUnread} + 1`,
        })
        .where(eq(chats.id, data.chatId));

      return message;
    });
  }

  /**
   * Отметка «прочитано» для одной стороны: обнуляет её счётчик и проставляет
   * время у входящих сообщений — по нему собеседник видит, что его прочли.
   */
  async markRead(chatId: number, side: 'buyer' | 'seller'): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(chats)
        .set(side === 'buyer' ? { buyerUnread: 0 } : { sellerUnread: 0 })
        .where(eq(chats.id, chatId));

      await tx
        .update(chatMessages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(chatMessages.chatId, chatId),
            isNull(chatMessages.readAt),
            side === 'buyer'
              ? sql`${chatMessages.kind} <> 'buyer'`
              : sql`${chatMessages.kind} = 'buyer'`,
          ),
        );
    });
  }

  /**
   * Сколько непрочитанного у человека в обеих ролях. Один запрос на оба
   * значения: значок в шапке спрашивают на каждой странице.
   */
  async unreadTotals(
    userId: number,
  ): Promise<{ buyer: number; seller: number }> {
    const [row] = await this.db
      .select({
        buyer: sql<number>`coalesce(sum(case when ${chats.buyerId} = ${userId} then ${chats.buyerUnread} else 0 end), 0)::int`,
        seller: sql<number>`coalesce(sum(case when ${shops.owner} = ${userId} then ${chats.sellerUnread} else 0 end), 0)::int`,
      })
      .from(chats)
      .innerJoin(shops, eq(shops.id, chats.shopId))
      .where(sql`${chats.buyerId} = ${userId} or ${shops.owner} = ${userId}`);

    return { buyer: row?.buyer ?? 0, seller: row?.seller ?? 0 };
  }

  private async list(where: SQL, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const [data, totalRows] = await Promise.all([
      this.db
        .select(CHAT_FIELDS)
        .from(chats)
        .innerJoin(shops, eq(shops.id, chats.shopId))
        .innerJoin(users, eq(users.id, chats.buyerId))
        .leftJoin(productCards, eq(productCards.id, chats.productCardId))
        .where(where)
        .orderBy(desc(chats.lastMessageAt))
        .limit(limit)
        .offset(offset),
      this.db.select(COUNT).from(chats).where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }
}
