import { SQL, and, eq, inArray } from 'drizzle-orm';
import { productCards, shops } from './schema';
import type { DrizzleDb } from './db.provider';

export const VISIBLE_PRODUCT: readonly SQL[] = [
  eq(productCards.status, 'active'),
  eq(shops.status, 'active'),
];

export const PUBLIC_PRODUCT_SUMMARY = {
  id: productCards.id,
  shopId: productCards.shopId,
  shopName: shops.name,
  name: productCards.name,
  description: productCards.description,
  photos: productCards.photos,
  price: productCards.price,
  state: productCards.state,
};

export async function filterVisibleProductIds(
  db: DrizzleDb,
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();

  const rows = await db
    .select({ id: productCards.id })
    .from(productCards)
    .innerJoin(shops, eq(productCards.shopId, shops.id))
    .where(and(inArray(productCards.id, ids), ...VISIBLE_PRODUCT));

  return new Set(rows.map((r) => r.id));
}
