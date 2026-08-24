/**
 * Разбор ответа и ошибок OpenRouter — общий для всех, кто к нему ходит.
 *
 * Обе функции были скопированы в генерацию картинок и в автозаполнение
 * карточки слово в слово. Расходиться им нельзя: по первой считаются деньги,
 * по второй чинят обрывы связи.
 */

/**
 * Стоимость запроса у OpenRouter, доллары. В типах SDK этого поля нет — это
 * расширение OpenRouter, поэтому читаем через unknown, а не приводим весь
 * `usage`. `undefined` — стоимость не пришла: списывать придётся по оценке.
 */
export function usageCost(usage: unknown): number | undefined {
  const cost = (usage as { cost?: unknown } | undefined)?.cost;
  return typeof cost === 'number' && cost > 0 ? cost : undefined;
}

/**
 * Разбор ошибки SDK. Отдельно вытаскиваем `cause`: при обрыве связи наружу
 * летит общее «Connection error.», а настоящая причина (ECONNRESET, таймаут
 * заголовков, сброс TLS) лежит только там — без неё чинить нечего.
 */
export function describeError(err: unknown): string {
  const e = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  return [
    e.status ? `HTTP ${e.status}` : null,
    e.code,
    e.message ?? String(err),
    e.cause
      ? `причина: ${e.cause.code ?? ''} ${e.cause.message ?? ''}`.trim()
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
