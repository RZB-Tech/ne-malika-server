import { createHash } from 'crypto';

export const PRODUCT_CACHE_PREFIX = 'pc:';

export const PRODUCT_LIST_TTL_SEC = 60;
export const PRODUCT_ITEM_TTL_SEC = 300;

export function productItemKey(id: number): string {
  return `${PRODUCT_CACHE_PREFIX}one:${id}`;
}

export function productListKey(query: Record<string, unknown>): string {
  const normalized = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');

  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  return `${PRODUCT_CACHE_PREFIX}list:${hash}`;
}
