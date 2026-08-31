import { listCacheKey } from '../../common/cache-key';

export const SHOP_CACHE_PREFIX = 'shop:';

/**
 * Две минуты: в выдачу входит число активных товаров, а товары меняются чаще
 * самих магазинов — сбрасывать кэш на каждую правку карточки дороже, чем
 * подождать до двух минут. Изменения самого магазина кэш сбрасывают сразу.
 */
export const SHOP_LIST_TTL_SEC = 120;

export function shopListKey(query: Record<string, unknown>): string {
  return listCacheKey(SHOP_CACHE_PREFIX, query);
}
