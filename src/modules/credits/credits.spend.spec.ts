import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTOFILL_CREDITS,
  autofillCharge,
  nextMonthStart,
  sellerVisibleMeta,
  splitSpend,
} from './credits.constants';
import {
  AUTOFILL_FREE_PER_MONTH,
  FREE_LIMITS,
  PLAN_LIMITS,
  effectiveLimits,
} from '../subscriptions/subscriptions.constants';

const SHOP = (
  plan: 'free' | 'start' | 'pro' | 'max',
  until: string | null,
) => ({
  subscriptionPlan: plan,
  subscriptionUntil: until === null ? null : new Date(until),
});

const NOW = new Date('2026-08-27T10:00:00Z');

describe('порядок карманов при списании', () => {
  it('нулевое списание не трогает ни один карман', () => {
    assert.deepEqual(splitSpend(0, 3000), {
      fromSubscription: 0,
      fromBalance: 0,
    });
  });

  it('берёт из подписочных, пока они есть', () => {
    assert.deepEqual(splitSpend(197, 3000), {
      fromSubscription: 197,
      fromBalance: 0,
    });
  });

  it('ровно по подписочным — купленных не касается', () => {
    assert.deepEqual(splitSpend(3000, 3000), {
      fromSubscription: 3000,
      fromBalance: 0,
    });
  });

  it('больше подписочных — остаток уходит с купленного счёта', () => {
    assert.deepEqual(splitSpend(3500, 3000), {
      fromSubscription: 3000,
      fromBalance: 500,
    });
  });

  it('на единицу больше подписочных — с купленного ровно один кредит', () => {
    assert.deepEqual(splitSpend(3001, 3000), {
      fromSubscription: 3000,
      fromBalance: 1,
    });
  });

  it('подписка истекла — всё списание с купленного счёта', () => {
    assert.deepEqual(splitSpend(500, 0), {
      fromSubscription: 0,
      fromBalance: 500,
    });
  });

  it('сумма частей всегда равна списанию', () => {
    for (const credits of [0, 1, 99, 197, 3000, 3001, 10_000]) {
      for (const usable of [0, 1, 3000, 6000]) {
        const split = splitSpend(credits, usable);
        assert.equal(
          split.fromSubscription + split.fromBalance,
          credits,
          `${credits} при ${usable} подписочных`,
        );
      }
    }
  });

  it('отрицательное, дробное и NaN схлопываются в ноль', () => {
    assert.deepEqual(splitSpend(-100, 3000), {
      fromSubscription: 0,
      fromBalance: 0,
    });
    assert.deepEqual(splitSpend(Number.NaN, 3000), {
      fromSubscription: 0,
      fromBalance: 0,
    });
    assert.deepEqual(splitSpend(10.7, 3000), {
      fromSubscription: 10,
      fromBalance: 0,
    });
    assert.deepEqual(splitSpend(100, -5), {
      fromSubscription: 0,
      fromBalance: 100,
    });
  });
});

describe('чем оплачивается следующее автозаполнение', () => {
  it('PRO и MAX — безлимит независимо от счётчика', () => {
    assert.equal(autofillCharge(PLAN_LIMITS.pro, 0), 'unlimited');
    assert.equal(autofillCharge(PLAN_LIMITS.max, 999), 'unlimited');
  });

  it('START — норма, пока она не исчерпана', () => {
    assert.equal(autofillCharge(PLAN_LIMITS.start, 0), 'free');
    assert.equal(autofillCharge(PLAN_LIMITS.start, 4), 'free');
  });

  it('START — норма исчерпана ровно на лимите', () => {
    assert.equal(AUTOFILL_FREE_PER_MONTH, 5);
    assert.equal(autofillCharge(PLAN_LIMITS.start, 5), 'paid');
    assert.equal(autofillCharge(PLAN_LIMITS.start, 6), 'paid');
  });

  it('без подписки автозаполнение платное с первого нажатия', () => {
    assert.equal(autofillCharge(FREE_LIMITS, 0), 'paid');
  });

  it('истёкший MAX платит за автозаполнение как бесплатный магазин', () => {
    const expired = SHOP('max', '2026-08-01T00:00:00Z');
    assert.equal(effectiveLimits(expired, NOW).id, 'free');
    assert.equal(autofillCharge(effectiveLimits(expired, NOW), 0), 'paid');
  });

  it('живой MAX платит абонплатой', () => {
    const alive = SHOP('max', '2026-09-27T00:00:00Z');
    assert.equal(autofillCharge(effectiveLimits(alive, NOW), 0), 'unlimited');
  });

  it('срок, истекающий ровно сейчас, уже не действует', () => {
    const edge = SHOP('start', NOW.toISOString());
    assert.equal(autofillCharge(effectiveLimits(edge, NOW), 0), 'paid');
  });

  it('цена платного автозаполнения — объявленный прайс', () => {
    assert.equal(AUTOFILL_CREDITS, 10);
  });
});

describe('дата обновления месячной нормы', () => {
  it('обычный месяц', () => {
    assert.equal(nextMonthStart('2026-08-01'), '2026-09-01');
  });

  it('переход через год', () => {
    assert.equal(nextMonthStart('2026-12-01'), '2027-01-01');
  });

  it('однозначный месяц дополняется нулём', () => {
    assert.equal(nextMonthStart('2026-01-01'), '2026-02-01');
    assert.equal(nextMonthStart('2026-09-01'), '2026-10-01');
  });
});

describe('что из журнала видит продавец', () => {
  it('не отдаёт себестоимость, оплаченную сумму и множитель наценки', () => {
    const visible = sellerVisibleMeta({
      operation: 'image',
      model: 'openai/gpt-image-2',
      usd: 0.0987,
      paidUsd: 20,
      markup: 2,
      estimated: true,
      images: 2,
      fromSubscription: 197,
    });

    assert.deepEqual(visible, {
      operation: 'image',
      images: 2,
      fromSubscription: 197,
    });
  });

  it('оставляет всё, что объясняет продавцу движение денег', () => {
    assert.deepEqual(
      sellerVisibleMeta({
        promo: 'subscription_burn',
        plan: 'pro',
        paymentId: 42,
      }),
      { promo: 'subscription_burn', plan: 'pro', paymentId: 42 },
    );
    assert.deepEqual(sellerVisibleMeta({ free: 'quota' }), { free: 'quota' });
    assert.deepEqual(sellerVisibleMeta({ fixed: true }), { fixed: true });
  });

  it('пустая мета остаётся пустой, а не превращается в объект', () => {
    assert.equal(sellerVisibleMeta(null), null);
    assert.deepEqual(sellerVisibleMeta({}), {});
  });

  it('нули и false не теряются по дороге', () => {
    assert.deepEqual(sellerVisibleMeta({ fromSubscription: 0, fixed: false }), {
      fromSubscription: 0,
      fixed: false,
    });
  });
});
