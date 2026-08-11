/**
 * Кредиты — внутренняя единица расхода на ИИ.
 *
 * 1000 кредитов = $1 фактической стоимости у OpenRouter. Целое число, а не
 * доллары с плавающей точкой: при тысячах мелких списаний доли цента копят
 * ошибку, а сравнение «хватает ли остатка» должно быть точным.
 *
 * Продавцу показываются именно кредиты, а не доллары: так себестоимость
 * запроса и наценка площадки не раскрываются, а множитель можно менять, не
 * объясняясь перед продавцами.
 */
export const CREDITS_PER_USD = 1000;

/** Множитель по умолчанию: $20 от магазина = $10 доступного расхода. */
export const DEFAULT_CREDIT_MARKUP = 2;

/** Ключ настройки в app_settings. */
export const CREDIT_MARKUP_KEY = 'credit_markup';

/**
 * Доллары OpenRouter в кредиты. Всегда вверх: недосписать хуже, чем округлить
 * в свою пользу на десятую долю цента — иначе самые дешёвые запросы (промпт за
 * $0.0003) не стоили бы магазину ничего.
 */
export function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * CREDITS_PER_USD);
}

export function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD;
}

/**
 * Предварительные оценки стоимости — только чтобы занять резерв до запроса и
 * не пустить магазин с пустым балансом. Списывается всегда фактическая
 * стоимость из ответа OpenRouter; оценка нужна ровно на время запроса.
 *
 * Значения намеренно с запасом: занизить резерв означает пустить в минус.
 */
export const PROMPT_ESTIMATE_CREDITS = 5;

/** Оценка одной картинки по тиру разрешения. Ключ — сторона квадрата. */
const IMAGE_ESTIMATE_BY_TIER: { maxSide: number; credits: number }[] = [
  { maxSide: 1300, credits: 60 },
  { maxSide: 2100, credits: 120 },
  { maxSide: 2600, credits: 180 },
  { maxSide: Number.POSITIVE_INFINITY, credits: 260 },
];

/** Оценка на всю пачку: размер берём из строки вида «1440x1920». */
export function estimateImageCredits(size: string, count: number): number {
  const side = Math.max(
    ...size.split('x').map((n) => Number.parseInt(n, 10) || 0),
  );
  const tier =
    IMAGE_ESTIMATE_BY_TIER.find((t) => side <= t.maxSide) ??
    IMAGE_ESTIMATE_BY_TIER[IMAGE_ESTIMATE_BY_TIER.length - 1];
  return tier.credits * Math.max(1, count);
}
