import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlans, type PaidPlan } from './subscriptions.constants';

const PRICES: Record<PaidPlan, number> = {
  start: 65_000,
  pro: 130_000,
  max: 260_000,
};

describe('прайс подписки', () => {
  it('собирает три тарифа с ценами из окружения', () => {
    const plans = buildPlans(PRICES);

    assert.equal(plans.length, 3);
    assert.deepEqual(
      plans.map((plan) => [plan.id, plan.priceUzs]),
      [
        ['start', 65_000],
        ['pro', 130_000],
        ['max', 260_000],
      ],
    );
  });

  it('отвергает совпадающие цены тарифов', () => {
    assert.throws(
      () => buildPlans({ ...PRICES, pro: PRICES.start }),
      /попарно различны/,
    );
  });

  it('отвергает нулевую и дробную цену', () => {
    assert.throws(() => buildPlans({ ...PRICES, pro: 0 }), /задана неверно/);
    assert.throws(
      () => buildPlans({ ...PRICES, pro: 130_000.5 }),
      /задана неверно/,
    );
    assert.throws(
      () => buildPlans({ ...PRICES, pro: Number.NaN }),
      /задана неверно/,
    );
  });

  describe('тестовая сумма', () => {
    it('принимается, когда не совпадает ни с одним тарифом', () => {
      assert.doesNotThrow(() => buildPlans(PRICES, 1_000));
    });

    it('отвергается при совпадении с ценой тарифа', () => {
      assert.throws(
        () => buildPlans(PRICES, PRICES.start),
        /совпадает с ценой тарифа/,
      );
      assert.throws(
        () => buildPlans(PRICES, PRICES.max),
        /совпадает с ценой тарифа/,
      );
    });

    it('отвергается при нулевом или дробном значении', () => {
      assert.throws(() => buildPlans(PRICES, 0), /задана неверно/);
      assert.throws(() => buildPlans(PRICES, 1_000.5), /задана неверно/);
      assert.throws(() => buildPlans(PRICES, Number.NaN), /задана неверно/);
    });

    it('не требуется', () => {
      assert.doesNotThrow(() => buildPlans(PRICES, undefined));
    });
  });
});
