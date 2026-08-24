import { SQL, and, eq, inArray } from 'drizzle-orm';
import { productCards, shops } from './schema';
import type { DrizzleDb } from './db.provider';

/**
 * Что значит «товар на витрине» — в одном месте.
 *
 * Условие спрашивают четверо: каталог, избранное, история просмотров и счётчик
 * статистики. Пока оно было скопировано, любое уточнение (появится, например,
 * статус `hidden` у магазина) требовалось бы внести четыре раза, а забытая
 * копия молча показывала бы покупателю снятую карточку.
 */
export const VISIBLE_PRODUCT: readonly SQL[] = [
  eq(productCards.status, 'active'),
  eq(shops.status, 'active'),
];

/**
 * Публичная проекция карточки: общая часть избранного и истории просмотров.
 * Оба списка рисуются на клиенте одним компонентом, поэтому и поля у них
 * обязаны совпадать — соответствует `PublicProductSummaryDto`.
 *
 * Требует join с `shops` — ради `shopName`.
 */
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

/**
 * Оставляет из присланных id те, что видны покупателю. Внешний ключ
 * подтверждает только существование товара — без этой проверки в избранное или
 * в историю попала бы скрытая модератором карточка, а по ответу можно было бы
 * перебором узнать, что товар с таким id существует.
 */
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
