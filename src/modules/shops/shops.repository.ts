import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { NewShop, Shop, productCards, shops, users } from '../../db/schema';
import { FindAdminShopsQueryDto } from './dto/find-admin-shops-query.dto';

@Injectable()
export class ShopsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewShop): Promise<Shop> {
    return this.db
      .insert(shops)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findByOwner(ownerId: number): Promise<Shop[]> {
    return this.db
      .select()
      .from(shops)
      .where(eq(shops.owner, ownerId))
      .orderBy(desc(shops.createdAt));
  }

  findFirstByOwner(ownerId: number): Promise<Shop | undefined> {
    return this.db.query.shops.findFirst({
      where: eq(shops.owner, ownerId),
    });
  }

  findById(id: number): Promise<Shop | undefined> {
    return this.db.query.shops.findFirst({ where: eq(shops.id, id) });
  }

  findOwnedByIdAndOwner(
    id: number,
    ownerId: number,
  ): Promise<Shop | undefined> {
    return this.db.query.shops.findFirst({
      where: and(eq(shops.id, id), eq(shops.owner, ownerId)),
    });
  }

  findPublicById(id: number) {
    return this.db.query.shops.findFirst({
      where: and(eq(shops.id, id), eq(shops.status, 'active')),
      with: {
        productCards: {
          where: eq(productCards.status, 'active'),
          orderBy: desc(productCards.createdAt),
        },
      },
    });
  }

  update(id: number, data: Partial<NewShop>): Promise<Shop> {
    return this.db
      .update(shops)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shops.id, id))
      .returning()
      .then((r) => r[0]);
  }

  delete(id: number): Promise<void> {
    return this.db
      .delete(shops)
      .where(eq(shops.id, id))
      .then(() => undefined);
  }

  /** Все магазины для админки — сразу с числом товаров, чтобы не делать запрос на строку. */
  async findAllWithProductCount(query: FindAdminShopsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const search = query.q?.trim();
    const where = search
      ? or(
          ilike(shops.name, `%${search}%`),
          ilike(shops.contact, `%${search}%`),
          ilike(shops.address, `%${search}%`),
          ilike(users.fullname, `%${search}%`),
          ilike(users.telegramUsername, `%${search}%`),
        )
      : undefined;

    const data = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        photo: shops.photo,
        telegramLink: shops.telegramLink,
        contact: shops.contact,
        address: shops.address,
        status: shops.status,
        abolishReason: shops.abolishReason,
        createdAt: shops.createdAt,
        productCount: sql<number>`count(${productCards.id})::int`,
        ownerId: users.id,
        ownerName: users.fullname,
        ownerUsername: users.telegramUsername,
        ownerBlockedAt: users.blockedAt,
        ownerBlockReason: users.blockReason,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .leftJoin(productCards, eq(productCards.shopId, shops.id))
      .where(where)
      .groupBy(shops.id, users.id)
      .orderBy(desc(shops.createdAt))
      .limit(limit)
      .offset(offset);

    // Счёт идёт по тому же join'у: поиск бьёт и по владельцу, без users
    // условие не собрать.
    const totalRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(where);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  restore(id: number): Promise<Shop> {
    return this.db
      .update(shops)
      .set({
        status: 'active',
        abolishReason: null,
        abolishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, id))
      .returning()
      .then((r) => r[0]);
  }

  abolish(id: number, reason: string): Promise<Shop> {
    return this.db
      .update(shops)
      .set({
        status: 'abolished',
        abolishReason: reason,
        abolishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, id))
      .returning()
      .then((r) => r[0]);
  }
}
