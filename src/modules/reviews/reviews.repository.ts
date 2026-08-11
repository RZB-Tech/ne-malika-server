import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import {
  type NewReview,
  type Review,
  productCards,
  reviews,
  shops,
  users,
} from '../../db/schema';
import {
  recomputeProductRating,
  recomputeShopRating,
  type Tx,
} from '../../db/rating';
import { FindReviewsQueryDto } from './dto/find-reviews-query.dto';
import { FindAdminReviewsQueryDto } from './dto/find-admin-reviews-query.dto';

/** Что видит покупатель. Фамилию автора целиком наружу не отдаём — сокращает сервис. */
const PUBLIC_FIELDS = {
  id: reviews.id,
  rating: reviews.rating,
  text: reviews.text,
  createdAt: reviews.createdAt,
  shopId: reviews.shopId,
  productCardId: reviews.productCardId,
  /** На странице продавца видно, о каком товаре речь. */
  productName: productCards.name,
  authorName: users.fullname,
  authorPhoto: users.telegramPhoto,
};

/** Свой отзыв автор видит целиком — включая статус и причину отказа. */
const OWN_FIELDS = {
  id: reviews.id,
  rating: reviews.rating,
  text: reviews.text,
  status: reviews.status,
  moderationNote: reviews.moderationNote,
  createdAt: reviews.createdAt,
  shopId: reviews.shopId,
  productCardId: reviews.productCardId,
  shopName: shops.name,
  productName: productCards.name,
};

const COUNT = { count: sql<number>`count(*)::int` };

@Injectable()
export class ReviewsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewReview): Promise<Review> {
    return this.db
      .insert(reviews)
      .values(data)
      .returning()
      .then((rows) => rows[0]);
  }

  findById(id: number): Promise<Review | undefined> {
    return this.db.query.reviews.findFirst({ where: eq(reviews.id, id) });
  }

  /**
   * Опубликованные отзывы о товаре или магазине.
   *
   * Отзывы о магазине и о его товарах намеренно разделены: на странице товара
   * человек ждёт слов именно об этом товаре, а не о доставке продавца.
   */
  async listPublic(query: FindReviewsQueryDto) {
    const { page, limit, offset } = resolvePage(query);
    const where = and(eq(reviews.status, 'approved'), ...target(query));

    const [data, totalRows] = await Promise.all([
      this.db
        .select(PUBLIC_FIELDS)
        .from(reviews)
        .innerJoin(users, eq(users.id, reviews.authorId))
        .leftJoin(productCards, eq(productCards.id, reviews.productCardId))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select(COUNT).from(reviews).where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /**
   * Разбивка по звёздам — она же основа статистики: и гистограмма на карточке,
   * и всё, что потом посчитает по ней ИИ, собирается из этих пяти чисел.
   */
  async summary(query: FindReviewsQueryDto) {
    const rows = await this.db
      .select({ rating: reviews.rating, count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(and(eq(reviews.status, 'approved'), ...target(query)))
      .groupBy(reviews.rating);

    const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    for (const row of rows) {
      breakdown[row.rating] = row.count;
      total += row.count;
      sum += row.rating * row.count;
    }

    return {
      count: total,
      // Два знака — как и в сохранённой оценке: цифра в шапке и цифра над
      // гистограммой обязаны совпадать до последнего знака.
      average: total > 0 ? Math.round((sum / total) * 100) / 100 : 0,
      breakdown,
    };
  }

  /**
   * Свои отзывы. Фильтр по товару или магазину здесь точный, а не как в
   * публичном списке: клиенту нужно знать, писал ли этот человек отзыв именно
   * об этой карточке — чтобы предложить исправить, а не оставить второй.
   */
  async listOwn(authorId: number, query: FindReviewsQueryDto) {
    const { page, limit, offset } = resolvePage(query);
    const where = and(eq(reviews.authorId, authorId), ...ownTarget(query))!;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(OWN_FIELDS)
        .from(reviews)
        .innerJoin(shops, eq(shops.id, reviews.shopId))
        .leftJoin(productCards, eq(productCards.id, reviews.productCardId))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select(COUNT).from(reviews).where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /** Очередь модерации. По умолчанию сначала непроверенные — ради них и заходят. */
  async listForAdmin(query: FindAdminReviewsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const conditions: SQL[] = target(query);
    if (query.status) conditions.push(eq(reviews.status, query.status));
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, totalRows] = await Promise.all([
      this.db
        .select({
          ...OWN_FIELDS,
          authorId: reviews.authorId,
          authorName: users.fullname,
          authorPhoto: users.telegramPhoto,
          moderatedAt: reviews.moderatedAt,
        })
        .from(reviews)
        .innerJoin(users, eq(users.id, reviews.authorId))
        .innerJoin(shops, eq(shops.id, reviews.shopId))
        .leftJoin(productCards, eq(productCards.id, reviews.productCardId))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select(COUNT).from(reviews).where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /** Сколько отзывов в каждом состоянии — счётчик очереди в админке. */
  async statusCounts(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: reviews.status, count: sql<number>`count(*)::int` })
      .from(reviews)
      .groupBy(reviews.status);

    const counts: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  /**
   * Правка отзыва автором. Оценка меняется — значит, меняется и рейтинг, а
   * отзыв возвращается на проверку: иначе одобренный текст можно было бы
   * подменить чем угодно после модерации.
   */
  update(id: number, patch: Partial<NewReview>): Promise<Review | undefined> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(reviews)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(reviews.id, id))
        .returning();

      if (updated) await recompute(tx, updated);
      return updated;
    });
  }

  async delete(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(reviews)
        .where(eq(reviews.id, id))
        .returning();

      if (deleted) await recompute(tx, deleted);
    });
  }

  /** Решение модератора и пересчёт рейтинга — одной транзакцией. */
  setStatus(
    id: number,
    patch: {
      status: 'approved' | 'rejected';
      moderationNote: string | null;
      moderatedBy: number;
    },
  ): Promise<Review | undefined> {
    return this.update(id, { ...patch, moderatedAt: new Date() });
  }
}

/** Фильтр «о чём отзыв». Пустой — обо всём сразу, так собирают общую статистику. */
function target(query: FindReviewsQueryDto): SQL[] {
  if (query.product_id !== undefined) {
    return [eq(reviews.productCardId, query.product_id)];
  }
  if (query.shop_id !== undefined) {
    // Всё, что привязано к магазину, включая отзывы о его товарах: ровно из
    // этого же набора считается оценка продавца. Разойдись список с оценкой —
    // на странице висело бы «4,7» над тремя отзывами, дающими совсем другое.
    return [eq(reviews.shopId, query.shop_id)];
  }
  return [];
}

/** Ровно тот объект, о котором писали: отзыв о магазине — это отзыв без товара. */
function ownTarget(query: FindReviewsQueryDto): SQL[] {
  if (query.product_id !== undefined) {
    return [eq(reviews.productCardId, query.product_id)];
  }
  if (query.shop_id !== undefined) {
    return [eq(reviews.shopId, query.shop_id), isNull(reviews.productCardId)];
  }
  return [];
}

/**
 * Пересчёт оценок после правки отзыва. Товар — если отзыв о товаре, магазин —
 * всегда: оценка продавца складывается из отзывов обо всех его товарах.
 */
async function recompute(tx: Tx, review: Review): Promise<void> {
  if (review.productCardId !== null) {
    await recomputeProductRating(tx, review.productCardId);
  }
  await recomputeShopRating(tx, review.shopId);
}
