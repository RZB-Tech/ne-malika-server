import { SQL, and, eq, sql } from 'drizzle-orm';
import { productCards, reviews, shops } from './schema';
import type { Tx } from './db.provider';

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
