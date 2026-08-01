import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import { favorites, productCards, shops } from '../../db/schema';

/** Публичная проекция карточки + когда её добавили в избранное. */
const FAVORITE_FIELDS = {
  id: productCards.id,
  shopId: productCards.shopId,
  shopName: shops.name,
  name: productCards.name,
  description: productCards.description,
  photos: productCards.photos,
  price: productCards.price,
  state: productCards.state,
  addedAt: favorites.addedAt,
};

@Injectable()
export class FavoritesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Оставляет из присланных id те, что видны покупателю. Внешний ключ
   * подтверждает только существование товара — без этой проверки в избранное
   * попала бы скрытая модератором карточка.
   */
  async filterPublicIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();

    const rows = await this.db
      .select({ id: productCards.id })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(
        and(
          inArray(productCards.id, ids),
          eq(productCards.status, 'active'),
          eq(shops.status, 'active'),
        ),
      );

    return new Set(rows.map((r) => r.id));
  }

  /**
   * Повторное добавление не меняет дату: список отсортирован по тому, когда
   * товар положили в избранное, и «обновление» гоняло бы его наверх без причины.
   */
  add(userId: number, productCardId: number, addedAt = new Date()) {
    return this.db
      .insert(favorites)
      .values({ userId, productCardId, addedAt })
      .onConflictDoNothing({
        target: [favorites.userId, favorites.productCardId],
      })
      .returning()
      .then((r) => r[0]);
  }

  /** Слияние избранного устройства после входа. Уже сохранённое не трогаем. */
  async merge(
    userId: number,
    items: { productCardId: number; addedAt: Date }[],
  ): Promise<number> {
    if (items.length === 0) return 0;

    const rows = await this.db
      .insert(favorites)
      .values(items.map((i) => ({ userId, ...i })))
      .onConflictDoNothing({
        target: [favorites.userId, favorites.productCardId],
      })
      .returning({ id: favorites.id });

    return rows.length;
  }

  /**
   * Избранное пользователя, недавно добавленные сверху. Скрытые и упразднённые
   * товары отфильтрованы так же, как в каталоге: ссылка на 404 в кабинете хуже,
   * чем её отсутствие.
   */
  async findByUser(userId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);
    const where = and(
      eq(favorites.userId, userId),
      eq(productCards.status, 'active'),
      eq(shops.status, 'active'),
    );

    const [data, totalRows] = await Promise.all([
      this.db
        .select(FAVORITE_FIELDS)
        .from(favorites)
        .innerJoin(productCards, eq(favorites.productCardId, productCards.id))
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where)
        .orderBy(desc(favorites.addedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(favorites)
        .innerJoin(productCards, eq(favorites.productCardId, productCards.id))
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  remove(userId: number, productCardId: number): Promise<number> {
    return this.db
      .delete(favorites)
      .where(
        and(
          eq(favorites.userId, userId),
          eq(favorites.productCardId, productCardId),
        ),
      )
      .returning({ id: favorites.id })
      .then((r) => r.length);
  }

  clear(userId: number): Promise<number> {
    return this.db
      .delete(favorites)
      .where(eq(favorites.userId, userId))
      .returning({ id: favorites.id })
      .then((r) => r.length);
  }
}
