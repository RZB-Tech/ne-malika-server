import { subscriptionPlanEnum, type Shop } from '../../db/schema';
import { monthStart, TZ } from '../product-stats/product-stats.util';

export { monthStart, TZ };

export const PLAN_VALUES = [...subscriptionPlanEnum.enumValues];

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

export const PAID_PLANS = ['start', 'pro', 'max'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

/**
 * Кассы, через которые продавец может заплатить. `manual` в списке нет:
 * такую подписку выдаёт администратор руками.
 */
export const CHECKOUT_PROVIDERS = ['click', 'payme'] as const;
export type CheckoutProvider = (typeof CHECKOUT_PROVIDERS)[number];

export type SubscriptionPlanId = Shop['subscriptionPlan'];

export function isPaidPlan(value: unknown): value is PaidPlan {
  return (
    typeof value === 'string' &&
    (PAID_PLANS as readonly string[]).includes(value)
  );
}

export interface PlanLimits {
  id: SubscriptionPlanId;
  months: number;
  credits: number;
  freeAutofills: number | null;
  promoWeight: number;
  bannerSlots: number;
  analyticsDays: number;
}

export const PLAN_LIMITS: Record<PaidPlan, PlanLimits> = {
  start: {
    id: 'start',
    months: 1,
    credits: 3_000,
    freeAutofills: 5,
    promoWeight: 1,
    bannerSlots: 0,
    analyticsDays: 30,
  },
  pro: {
    id: 'pro',
    months: 1,
    credits: 6_000,
    freeAutofills: null,
    promoWeight: 2,
    bannerSlots: 0,
    analyticsDays: 30,
  },
  max: {
    id: 'max',
    months: 1,
    credits: 10_000,
    freeAutofills: null,
    promoWeight: 3,
    bannerSlots: 1,
    analyticsDays: 365,
  },
};

export const FREE_LIMITS: PlanLimits = {
  id: 'free',
  months: 0,
  credits: 0,
  freeAutofills: 0,
  promoWeight: 1,
  bannerSlots: 0,
  analyticsDays: 30,
};

export function effectiveLimits(
  shop: Pick<Shop, 'subscriptionPlan' | 'subscriptionUntil'>,
  now: Date = new Date(),
): PlanLimits {
  const until = shop.subscriptionUntil;
  if (!until || until.getTime() <= now.getTime()) return FREE_LIMITS;
  if (!isPaidPlan(shop.subscriptionPlan)) return FREE_LIMITS;
  return PLAN_LIMITS[shop.subscriptionPlan];
}

export interface PlanSpec extends PlanLimits {
  id: PaidPlan;
  priceUzs: number;
}

export function buildPlans(
  prices: Record<PaidPlan, number>,
  testPriceUzs?: number,
): PlanSpec[] {
  const plans = PAID_PLANS.map((id) => ({
    ...PLAN_LIMITS[id],
    id,
    priceUzs: prices[id],
  }));

  for (const plan of plans) {
    if (!Number.isInteger(plan.priceUzs) || plan.priceUzs <= 0) {
      throw new Error(
        `Цена тарифа ${plan.id} задана неверно: ${String(plan.priceUzs)}. ` +
          'Ожидается целое число сумов больше нуля.',
      );
    }
  }

  const distinct = new Set(plans.map((plan) => plan.priceUzs));
  if (distinct.size !== plans.length) {
    throw new Error(
      'Цены тарифов обязаны быть попарно различны: тариф в колбэке Click ' +
        'определяется только по сумме платежа.',
    );
  }

  if (testPriceUzs !== undefined) {
    if (!Number.isInteger(testPriceUzs) || testPriceUzs <= 0) {
      throw new Error(
        `Тестовая сумма задана неверно: ${String(testPriceUzs)}. ` +
          'Ожидается целое число сумов больше нуля.',
      );
    }

    if (distinct.has(testPriceUzs)) {
      throw new Error(
        `Тестовая сумма ${testPriceUzs} совпадает с ценой тарифа: оплата ` +
          'этого тарифа попадала бы в ветку теста и не выдавала бы ничего.',
      );
    }
  }

  return plans;
}

export const AUTOFILL_FREE_PER_MONTH = PLAN_LIMITS.start.freeAutofills ?? 0;

export function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() !== day) next.setUTCDate(0);
  return next;
}

export const REMINDER_LEAD_DAYS = 3;

export const TEST_WINDOW_MINUTES = 30;

export const ORDER_REUSE_MINUTES = 30;

export const MANUAL_ACTIVATION_MAX_MONTHS = 12;

export const MANUAL_ACTIVATION_COOLDOWN_SEC = 60;

export const SUBSCRIPTION_GRANT_NOTE = 'Кредиты по подписке';
export const SUBSCRIPTION_BURN_NOTE =
  'Сгорели неиспользованные подписочные кредиты';
