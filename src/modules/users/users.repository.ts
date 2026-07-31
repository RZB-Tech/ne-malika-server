import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
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

  /**
   * Список для админки: пользователь, его магазин и число товаров.
   * Магазин присоединяем слева — админы и продавцы без магазина тоже нужны.
   */
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

  /** Последние изменённые товары пользователя — «недавние действия» в карточке. */
  findRecentActivity(userId: number, limit = 10) {
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
      .limit(limit);
  }

  setRole(id: number, role: 'seller' | 'admin'): Promise<User> {
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
    data: Pick<NewUser, 'telegramUsername' | 'telegramPhoto' | 'fullname'>,
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

  /** Вызывается BotModule после получения контакта через request_contact. */
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
      role: 'seller',
    });
  }
}
