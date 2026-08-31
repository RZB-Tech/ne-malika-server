import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { NewShop, Shop, productCards, shops, users } from '../../db/schema';
import { FindAdminShopsQueryDto } from './dto/find-admin-shops-query.dto';
import {
  FindPublicShopsQueryDto,
  PublicShopSort,
} from './dto/find-public-shops-query.dto';
import { escapeLike } from '../product-cards/product-search';

/**
 * Магазин без единого активного товара в публичной выдаче не нужен: покупателю
 * там нечего смотреть, а поисковику такая страница уходит как пустая.
 */
const hasActiveProducts = sql`exists (
  select 1 from ${productCards}
  where ${eq(productCards.shopId, shops.id)}
    and ${eq(productCards.status, 'active')}
)`;

const activeProductCount = sql<number>`(
  select count(*)::int from ${productCards}
  where ${eq(productCards.shopId, shops.id)}
    and ${eq(productCards.status, 'active')}
)`;

/**
 * Порядок в публичном каталоге. Последним столбцом всегда id: без него две
 * страницы подряд могут вернуть один и тот же магазин, если у соседей
 * совпали оценки или число товаров.
 */
function publicShopOrder(sort: PublicShopSort): SQL[] {
  switch (sort) {
    case 'rating':
      return [
        // Магазины без отзывов уходят в конец: нулевая оценка — это «неизвестно»,
        // а не «плохо», и держать их выше магазина с двумя сотнями отзывов нечестно.
        sql`${shops.ratingCount} = 0`,
        desc(shops.ratingAvg),
        desc(shops.ratingCount),
        asc(shops.id),
      ];
    case 'newest':
      return [desc(shops.createdAt), asc(shops.id)];
    case 'name':
      return [asc(shops.name), asc(shops.id)];
    default:
      return [desc(activeProductCount), desc(shops.ratingAvg), asc(shops.id)];
  }
}

@Injectable()
export class ShopsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  createAndPromoteOwner(data: NewShop): Promise<Shop> {
    return this.db.transaction(async (tx) => {
      const [shop] = await tx.insert(shops).values(data).returning();

      await tx
        .update(users)
        .set({ role: 'seller', updatedAt: new Date() })
        .where(and(eq(users.id, data.owner), eq(users.role, 'user')));

      return shop;
    });
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
      // Список колонок задан явно: у магазина в той же строке лежат баланс
      // кредитов, тариф и расход автозаполнений — на публичном эндпоинте
      // им делать нечего.
      columns: {
        id: true,
        owner: true,
        name: true,
        description: true,
        photo: true,
        telegramLink: true,
        contact: true,
        address: true,
        workSchedule: true,
        location: true,
        ratingAvg: true,
        ratingCount: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        productCards: {
          where: eq(productCards.status, 'active'),
          orderBy: desc(productCards.createdAt),
        },
      },
    });
  }

  async findPublicList(query: FindPublicShopsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const search = query.q?.trim();
    const pattern = search ? `%${escapeLike(search)}%` : null;

    const where = and(
      eq(shops.status, 'active'),
      hasActiveProducts,
      pattern
        ? or(ilike(shops.name, pattern), ilike(shops.address, pattern))
        : undefined,
    );

    const data = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        description: shops.description,
        photo: shops.photo,
        address: shops.address,
        telegramLink: shops.telegramLink,
        workSchedule: shops.workSchedule,
        ratingAvg: shops.ratingAvg,
        ratingCount: shops.ratingCount,
        productCount: activeProductCount,
        createdAt: shops.createdAt,
      })
      .from(shops)
      .where(where)
      .orderBy(...publicShopOrder(query.sort ?? 'products'))
      .limit(limit)
      .offset(offset);

    const totalRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(where);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  findPublicIds(): Promise<{ id: number; updatedAt: Date }[]> {
    return this.db
      .select({ id: shops.id, updatedAt: shops.updatedAt })
      .from(shops)
      .where(and(eq(shops.status, 'active'), hasActiveProducts))
      .orderBy(desc(shops.updatedAt));
  }

  update(id: number, data: Partial<NewShop>): Promise<Shop> {
    return this.db
      .update(shops)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shops.id, id))
      .returning()
      .then((r) => r[0]);
  }

  updateOwned(
    id: number,
    ownerId: number,
    data: Partial<NewShop>,
  ): Promise<Shop | undefined> {
    return this.db
      .update(shops)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(shops.id, id), eq(shops.owner, ownerId)))
      .returning()
      .then((r) => r[0]);
  }

  deleteAndDemoteOwner(id: number, ownerId: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(shops)
        .where(and(eq(shops.id, id), eq(shops.owner, ownerId)))
        .returning({ id: shops.id });

      if (deleted.length === 0) return false;

      await tx
        .update(users)
        .set({ role: 'user', updatedAt: new Date() })
        .where(and(eq(users.id, ownerId), eq(users.role, 'seller')));

      return true;
    });
  }

  async findAllWithProductCount(query: FindAdminShopsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const search = query.q?.trim();
    const pattern = search ? `%${escapeLike(search)}%` : null;
    const where = pattern
      ? or(
          ilike(shops.name, pattern),
          ilike(shops.contact, pattern),
          ilike(shops.address, pattern),
          ilike(users.fullname, pattern),
          ilike(users.telegramUsername, pattern),
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
        restrictedCategoriesEnabled: shops.restrictedCategoriesEnabled,
        createdAt: shops.createdAt,
        ratingAvg: shops.ratingAvg,
        ratingCount: shops.ratingCount,
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

  setRestrictedCategories(id: number, enabled: boolean): Promise<Shop> {
    return this.db
      .update(shops)
      .set({ restrictedCategoriesEnabled: enabled, updatedAt: new Date() })
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
