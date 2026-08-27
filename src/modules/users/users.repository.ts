import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { UserRole } from '../../common/types/auth.types';
import { NewUser, User, productCards, shops, users } from '../../db/schema';

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  findByTelegramId(telegramId: number): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.telegramId, telegramId),
    });
  }

  findById(id: number): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
  }

  async hasShop(ownerId: number): Promise<boolean> {
    const shop = await this.db.query.shops.findFirst({
      columns: { id: true },
      where: eq(shops.owner, ownerId),
    });
    return shop !== undefined;
  }

  async findAllForAdmin(query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const data = await this.db
      .select({
        id: users.id,
        fullname: users.fullname,
        role: users.role,
        telegramId: users.telegramId,
        telegramUsername: users.telegramUsername,
        telegramPhoto: users.telegramPhoto,
        phoneNumber: users.phoneNumber,
        blockedAt: users.blockedAt,
        blockReason: users.blockReason,
        createdAt: users.createdAt,
        shopId: shops.id,
        shopName: shops.name,
        shopStatus: shops.status,
        creditsBalance: shops.creditsBalance,
        creditsReserved: shops.creditsReserved,
        productCount: sql<number>`count(${productCards.id})::int`,
        lastProductAt: sql<string | null>`max(${productCards.updatedAt})`,
      })
      .from(users)
      .leftJoin(shops, eq(shops.owner, users.id))
      .leftJoin(productCards, eq(productCards.shopId, shops.id))
      .groupBy(users.id, shops.id)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  findRecentActivity(userId: number) {
    return this.db
      .select({
        id: productCards.id,
        name: productCards.name,
        status: productCards.status,
        price: productCards.price,
        createdAt: productCards.createdAt,
        updatedAt: productCards.updatedAt,
        shopName: shops.name,
      })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(eq(shops.owner, userId))
      .orderBy(desc(productCards.updatedAt))
      .limit(10);
  }

  setRole(id: number, role: UserRole): Promise<User> {
    return this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
      .then((rows) => rows[0]);
  }

  create(data: NewUser): Promise<User> {
    return this.db
      .insert(users)
      .values(data)
      .returning()
      .then((rows) => rows[0]);
  }

  updateProfileFromTelegram(
    id: number,
    data: Partial<Pick<NewUser, 'telegramUsername' | 'telegramPhoto'>>,
  ): Promise<User> {
    return this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
      .then((rows) => rows[0]);
  }

  setBlocked(id: number, reason: string | null): Promise<User> {
    return this.db
      .update(users)
      .set({
        blockedAt: reason === null ? null : new Date(),
        blockReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning()
      .then((rows) => rows[0]);
  }

  async bindChat(telegramId: number, chatId: number): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({
        telegramChatId: chatId,
        telegramNotificationsEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(users.telegramId, telegramId))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async setNotificationsByTelegramId(
    telegramId: number,
    enabled: boolean,
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ telegramNotificationsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.telegramId, telegramId));
  }

  async upsertFromBotContact(data: {
    telegramId: number;
    telegramChatId: number;
    phoneNumber: string;
    fullname: string;
    telegramUsername?: string;
  }): Promise<User> {
    const existing = await this.findByTelegramId(data.telegramId);

    if (existing) {
      return this.db
        .update(users)
        .set({
          phoneNumber: data.phoneNumber,
          telegramChatId: data.telegramChatId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning()
        .then((rows) => rows[0]);
    }

    return this.create({
      telegramId: data.telegramId,
      telegramChatId: data.telegramChatId,
      telegramUsername: data.telegramUsername,
      phoneNumber: data.phoneNumber,
      fullname: data.fullname,
      role: 'user',
    });
  }
}
