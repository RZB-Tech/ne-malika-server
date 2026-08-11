import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  type Broadcast,
  broadcasts,
  productCards,
  shops,
  users,
} from '../../db/schema';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import type { BroadcastAudience } from './dto/create-broadcast.dto';

/** Адресат: id нужен, чтобы отметить отписку, chatId — чтобы отправить. */
export interface Recipient {
  id: number;
  chatId: number;
}

/**
 * Кому бот вправе писать. Условие одно и то же во всех выборках, поэтому
 * собрано в одном месте: есть чат (значит, был /start), уведомления не
 * выключены, аккаунт не заблокирован.
 */
const REACHABLE = and(
  isNotNull(users.telegramChatId),
  eq(users.telegramNotificationsEnabled, true),
  isNull(users.blockedAt),
);

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Администраторы — им уходят жалобы и сбои проверки. */
  admins(): Promise<Recipient[]> {
    return this.db
      .select({ id: users.id, chatId: sql<number>`${users.telegramChatId}` })
      .from(users)
      .where(and(REACHABLE, eq(users.role, 'admin')));
  }

  async one(userId: number): Promise<Recipient | undefined> {
    const rows = await this.db
      .select({ id: users.id, chatId: sql<number>`${users.telegramChatId}` })
      .from(users)
      .where(and(REACHABLE, eq(users.id, userId)))
      .limit(1);
    return rows[0];
  }

  audience(audience: BroadcastAudience): Promise<Recipient[]> {
    const byRole =
      audience === 'sellers'
        ? eq(users.role, 'seller')
        : audience === 'buyers'
          ? eq(users.role, 'user')
          : undefined;

    return this.db
      .select({ id: users.id, chatId: sql<number>`${users.telegramChatId}` })
      .from(users)
      .where(byRole ? and(REACHABLE, byRole) : REACHABLE);
  }

  /**
   * Продавцы, которых пора подтолкнуть: с активным магазином, давно не
   * добавлявшие товар и давно не получавшие напоминание.
   *
   * `productCount` отличает «магазин пустой» от «магазин есть, но заглох» —
   * тексты для этих двух случаев разные.
   */
  staleSellers(staleBefore: Date, nudgedBefore: Date) {
    return this.db
      .select({
        id: users.id,
        chatId: sql<number>`${users.telegramChatId}`,
        shopName: shops.name,
        productCount: sql<number>`count(${productCards.id})::int`,
        lastProductAt: sql<Date | null>`max(${productCards.createdAt})`,
      })
      .from(users)
      .innerJoin(shops, eq(shops.owner, users.id))
      .leftJoin(productCards, eq(productCards.shopId, shops.id))
      .where(
        and(
          REACHABLE,
          eq(shops.status, 'active'),
          or(isNull(users.lastNudgeAt), lt(users.lastNudgeAt, nudgedBefore)),
        ),
      )
      .groupBy(users.id, shops.id)
      .having(
        or(
          sql`count(${productCards.id}) = 0`,
          sql`max(${productCards.createdAt}) < ${staleBefore}`,
        ),
      );
  }

  markNudged(userIds: number[]): Promise<unknown> {
    if (userIds.length === 0) return Promise.resolve(null);
    return this.db
      .update(users)
      .set({ lastNudgeAt: new Date(), updatedAt: new Date() })
      .where(sql`${users.id} = ANY(${userIds})`);
  }

  /** Бот заблокирован пользователем — больше не пишем, пока не вернётся сам. */
  disableNotifications(userId: number): Promise<unknown> {
    return this.db
      .update(users)
      .set({ telegramNotificationsEnabled: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  setNotifications(telegramId: number, enabled: boolean): Promise<unknown> {
    return this.db
      .update(users)
      .set({ telegramNotificationsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.telegramId, telegramId));
  }

  createBroadcast(data: {
    authorId: number;
    audience: BroadcastAudience;
    text: string;
    recipients: number;
  }): Promise<Broadcast> {
    return this.db
      .insert(broadcasts)
      .values(data)
      .returning()
      .then((rows) => rows[0]);
  }

  finishBroadcast(
    id: number,
    counters: { delivered: number; failed: number },
  ): Promise<Broadcast> {
    return this.db
      .update(broadcasts)
      .set(counters)
      .where(eq(broadcasts.id, id))
      .returning()
      .then((rows) => rows[0]);
  }

  async listBroadcasts(query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const data = await this.db
      .select({
        id: broadcasts.id,
        audience: broadcasts.audience,
        text: broadcasts.text,
        recipients: broadcasts.recipients,
        delivered: broadcasts.delivered,
        failed: broadcasts.failed,
        createdAt: broadcasts.createdAt,
        authorName: users.fullname,
      })
      .from(broadcasts)
      .leftJoin(users, eq(users.id, broadcasts.authorId))
      .orderBy(desc(broadcasts.createdAt))
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(broadcasts)
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }

  /** Сколько адресатов получит рассылка — показываем до отправки. */
  countAudience(audience: BroadcastAudience): Promise<number> {
    const byRole =
      audience === 'sellers'
        ? eq(users.role, 'seller')
        : audience === 'buyers'
          ? eq(users.role, 'user')
          : undefined;

    return this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(byRole ? and(REACHABLE, byRole) : REACHABLE)
      .then((rows) => rows[0]?.count ?? 0);
  }

  /** Есть ли у пользователя открытый чат с ботом — для подсказки на сайте. */
  async isLinked(userId: number): Promise<boolean> {
    const rows = await this.db
      .select({ chatId: users.telegramChatId })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.telegramChatId)))
      .limit(1);
    return rows.length > 0;
  }
}
