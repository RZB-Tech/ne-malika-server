import { SQL, and, eq, sql } from 'drizzle-orm';
import { productCards, reviews, shops } from './schema';
import type { DrizzleDb } from './db.provider';

/**
 * Пересчёт оценок по опубликованным отзывам.
 *
 * Живёт здесь, а не в модуле отзывов, чтобы им мог пользоваться и модуль
 * товаров: удаление товара уносит его отзывы каскадом, и оценку продавца надо
 * пересобрать. Импорт модуля отзывов туда создал бы кольцо — модуль отзывов
 * сам зависит от товаров.
 *
 * Всегда считается заново, а не приращением: приращение живёт правильно ровно
 * до первого пропущенного события — отклонили после одобрения, автор поменял
 * оценку, товар удалён вместе с отзывами, — и дальше цифра врёт молча.
 */

/** Транзакция drizzle: пересчёт обязан идти в одном коммите с самой правкой. */
export type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export async function recomputeProductRating(
  tx: Tx,
  productCardId: number,
): Promise<void> {
  const stats = await aggregate(tx, eq(reviews.productCardId, productCardId));
  await tx
    .update(productCards)
    .set({ ratingAvg: stats.average, ratingCount: stats.count })
    .where(eq(productCards.id, productCardId));
}

/** Оценка продавца собирает всё, что к нему привязано, — и отзывы о товарах. */
export async function recomputeShopRating(
  tx: Tx,
  shopId: number,
): Promise<void> {
  const stats = await aggregate(tx, eq(reviews.shopId, shopId));
  await tx
    .update(shops)
    .set({ ratingAvg: stats.average, ratingCount: stats.count })
    .where(eq(shops.id, shopId));
}

async function aggregate(
  tx: Tx,
  scope: SQL,
): Promise<{ average: number; count: number }> {
  const rows = await tx
    .select({
      average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(scope, eq(reviews.status, 'approved')));

  const row = rows[0];
  return { average: round2(row?.average ?? 0), count: row?.count ?? 0 };
}

/** Два знака: «4.33» — предел осмысленной точности для оценки по пяти звёздам. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
