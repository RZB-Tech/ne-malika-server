import type { CreditTxnMeta } from '../../db/schema';

export const CREDITS_PER_USD = 1000;

export const DEFAULT_CREDIT_MARKUP = 2;

export const CREDIT_MARKUP_KEY = 'credit_markup';

export const WELCOME_CREDITS = 300;

export const WELCOME_PROMO = 'welcome';

export const WELCOME_NOTE = 'Приветственные кредиты на пробную генерацию';

export const AUTOFILL_CREDITS = 10;

export function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * CREDITS_PER_USD);
}

const IMAGE_OUTPUT_USD_PER_TOKEN = 0.00003;
const IMAGE_INPUT_USD_PER_TOKEN = 0.000008;

const IMAGE_TOKENS_PER_PIXEL: Record<string, number> = {
  low: 272 / (1024 * 1024),
  medium: 1056 / (1024 * 1024),
  high: 4160 / (1024 * 1024),
  auto: 4160 / (1024 * 1024),
};

const IMAGE_REFERENCE_TOKENS = 1500;

export function estimateImagesUsd(
  size: string,
  quality: string | undefined,
  count: number,
  references: number,
): number {
  const [width = 0, height = 0] = size
    .split('x')
    .map((n) => Number.parseInt(n, 10) || 0);

  const perPixel =
    IMAGE_TOKENS_PER_PIXEL[quality ?? 'medium'] ??
    IMAGE_TOKENS_PER_PIXEL.medium;

  const outputUsd = width * height * perPixel * IMAGE_OUTPUT_USD_PER_TOKEN;
  const inputUsd =
    Math.max(1, references) *
    IMAGE_REFERENCE_TOKENS *
    IMAGE_INPUT_USD_PER_TOKEN;

  return (outputUsd + inputUsd) * Math.max(1, count);
}

export function estimatePromptUsd(): number {
  return 0.001;
}

export interface SpendSplit {
  fromSubscription: number;
  fromBalance: number;
}

export function splitSpend(
  credits: number,
  usableSubscription: number,
): SpendSplit {
  const total = asCount(credits);
  const fromSubscription = Math.min(total, asCount(usableSubscription));
  return { fromSubscription, fromBalance: total - fromSubscription };
}

function asCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function autofillCharge(
  limits: { freeAutofills: number | null },
  freeUsedThisMonth: number,
): 'unlimited' | 'free' | 'paid' {
  if (limits.freeAutofills === null) return 'unlimited';
  return asCount(limits.freeAutofills) > asCount(freeUsedThisMonth)
    ? 'free'
    : 'paid';
}

export function nextMonthStart(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  if (!year || !month) return monthStart;
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export function sellerVisibleMeta(
  meta: CreditTxnMeta | null,
): CreditTxnMeta | null {
  if (!meta) return null;
  const visible: CreditTxnMeta = {};
  if (meta.operation !== undefined) visible.operation = meta.operation;
  if (meta.images !== undefined) visible.images = meta.images;
  if (meta.promo !== undefined) visible.promo = meta.promo;
  if (meta.plan !== undefined) visible.plan = meta.plan;
  if (meta.fromSubscription !== undefined) {
    visible.fromSubscription = meta.fromSubscription;
  }
  if (meta.free !== undefined) visible.free = meta.free;
  if (meta.fixed !== undefined) visible.fixed = meta.fixed;
  if (meta.paymentId !== undefined) visible.paymentId = meta.paymentId;
  return visible;
}
