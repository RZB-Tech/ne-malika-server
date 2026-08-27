export function usageCost(usage: unknown): number | undefined {
  const cost = (usage as { cost?: unknown } | undefined)?.cost;
  return typeof cost === 'number' && cost > 0 ? cost : undefined;
}

const RAW_LIMIT = 600;

/**
 * OpenRouter при отказе апстрима отдаёт заглушку «Provider returned error»,
 * а дословный ответ провайдера кладёт в error.metadata. Без неё причину 400
 * не видно, поэтому вытаскиваем её сюда.
 */
export function describeError(err: unknown): string {
  const e = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
    error?: {
      metadata?: { provider_name?: string; raw?: unknown };
    };
  };

  const meta = e.error?.metadata;
  const raw =
    typeof meta?.raw === 'string'
      ? meta.raw
      : meta?.raw !== undefined
        ? JSON.stringify(meta.raw)
        : null;

  return [
    e.status ? `HTTP ${e.status}` : null,
    e.code,
    e.message ?? String(err),
    meta?.provider_name ? `провайдер: ${meta.provider_name}` : null,
    raw ? `ответ провайдера: ${raw.slice(0, RAW_LIMIT)}` : null,
    e.cause
      ? `причина: ${e.cause.code ?? ''} ${e.cause.message ?? ''}`.trim()
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
