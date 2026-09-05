export interface AssistantSearch {
  q?: string;
  categoryId?: number;
  minPrice?: number;
  maxPrice?: number;
  state?: 'new' | 'old';
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseObject(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return object(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseSearch(
  value: unknown,
  categoryIds: Set<number>,
): AssistantSearch | null {
  const input = object(value);
  if (!input) return null;
  const result: AssistantSearch = {};
  if (typeof input.q === 'string' && input.q.trim())
    result.q = input.q.trim().slice(0, 100);
  if (typeof input.categoryId === 'number') {
    // A made-up category must never turn into an unrestricted catalog search.
    if (!categoryIds.has(input.categoryId)) throw new Error('Unknown category');
    result.categoryId = input.categoryId;
  }
  for (const key of ['minPrice', 'maxPrice'] as const) {
    const price = input[key];
    if (price === null || price === undefined) continue;
    if (
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 1e12
    ) {
      throw new Error('Invalid price');
    }
    result[key] = price;
  }
  if (
    result.minPrice !== undefined &&
    result.maxPrice !== undefined &&
    result.minPrice > result.maxPrice
  ) {
    throw new Error('Invalid price range');
  }
  if (input.state === 'new' || input.state === 'old')
    result.state = input.state;
  // Ask what kind of device is needed instead of suggesting arbitrary inventory.
  return result.q || result.categoryId ? result : null;
}

export function parseReply(raw: string | null | undefined) {
  const input = parseObject(raw);
  if (!input || typeof input.message !== 'string' || !input.message.trim())
    return null;
  return {
    message: input.message.trim().slice(0, 2000),
    productIds: Array.isArray(input.productIds)
      ? [
          ...new Set(
            input.productIds.filter(
              (id): id is number =>
                typeof id === 'number' && Number.isInteger(id),
            ),
          ),
        ].slice(0, 4)
      : [],
    suggestions: Array.isArray(input.suggestions)
      ? [
          ...new Set(
            input.suggestions
              .filter((s): s is string => typeof s === 'string')
              .map((s) => s.trim().slice(0, 100))
              .filter(Boolean),
          ),
        ].slice(0, 3)
      : [],
    links: Array.isArray(input.links)
      ? [
          ...new Set(
            input.links.filter((s): s is string => typeof s === 'string'),
          ),
        ].slice(0, 3)
      : [],
  };
}
