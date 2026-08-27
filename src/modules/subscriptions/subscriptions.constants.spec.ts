import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlans, type PaidPlan } from './subscriptions.constants';

/** Боевой прайс — от него отталкиваются проверки ниже. */
const PRICES: Record<PaidPlan, number> = {
  start: 65_000,
  pro: 130_000,
  max: 260_000,
};

/**
 * Прайс проверяется на старте приложения, и это единственное место, где
 * ошибка в переменных окружения ловится до того, как её найдёт покупатель.
 * Тариф в колбэке Click определяется ТОЛЬКО по сумме платежа, поэтому каждая
 * из проверок ниже закрывает конкретный способ выдать человеку не то, за что
 * он заплатил.
 */
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

    /**
     * Самая дорогая из возможных опечаток: тестовая сумма, равная цене тарифа,
     * увела бы НАСТОЯЩУЮ оплату этого тарифа в ветку проверки кассы. Человек
     * заплатил бы полную цену и не получил ничего — тестовая оплата не выдаёт
     * ни кредитов, ни срока.
     */
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

    /** Не задана вовсе — законная настройка: проверка кассы просто выключена. */
    it('не требуется', () => {
      assert.doesNotThrow(() => buildPlans(PRICES, undefined));
    });
  });
});
