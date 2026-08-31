import { listCacheKey } from '../../common/cache-key';

export const PRODUCT_CACHE_PREFIX = 'pc:';

export const PRODUCT_LIST_TTL_SEC = 60;
export const PRODUCT_ITEM_TTL_SEC = 300;

export function productItemKey(id: number): string {
  return `${PRODUCT_CACHE_PREFIX}one:${id}`;
}

export function productListKey(query: Record<string, unknown>): string {
  return listCacheKey(PRODUCT_CACHE_PREFIX, query);
}
