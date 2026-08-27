export const SEARCH_QUERY_MAX_LENGTH = 100;

const SEARCH_QUERY_MIN_LENGTH = 3;

export const SEARCH_DEDUP_WINDOW_SEC = 600;

export const SEARCH_HIT_SHOP_LIMIT = 200;

export function normalizeSearchQuery(raw: string): string | null {
  const normalized = raw
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/\s+/g, ' ')
    .slice(0, SEARCH_QUERY_MAX_LENGTH)
    .trim();

  return normalized.length >= SEARCH_QUERY_MIN_LENGTH ? normalized : null;
}
