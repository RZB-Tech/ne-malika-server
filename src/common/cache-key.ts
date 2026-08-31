import { createHash } from 'crypto';

/**
 * Ключ кэша для списочного запроса: параметры приводятся к каноническому виду,
 * чтобы ?page=1&q=ноут и ?q=ноут&page=1 попадали в одну запись, а пустые
 * значения не плодили разные ключи для одинаковых по смыслу запросов.
 */
export function listCacheKey(
  prefix: string,
  query: Record<string, unknown>,
): string {
  const normalized = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');

  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  return `${prefix}list:${hash}`;
}
