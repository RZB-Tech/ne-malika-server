import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { ClickController } from './click.controller';
import { createClickSignature } from './click-protocol';
import type { ClickMerchantService, ClickReversalResult } from './click-merchant.service';
import type {
  CompleteResult,
  PrepareResult,
  SubscriptionsService,
} from './subscriptions.service';

/**
 * Таблица ветвлений колбэка Click.
 *
 * Проверяется не разбор тела (он закрыт `click-protocol.spec.ts`), а решения
 * контроллера: каким кодом он отвечает и — главное — в каких случаях трогает
 * деньги. Именно эта таблица ломается при любой правке «для порядка», а цена
 * поломки несимметрична: лишний возврат виден сразу, пропущенный обнаруживается
 * обращением продавца через неделю.
 *
 * Зависимости подменены вручную, без контейнера Nest: контроллер ничего не
 * знает ни про базу, ни про сеть, и поднимать ради семнадцати проверок целое
 * приложение значило бы проверять DI вместо ветвлений.
 */

const SECRET = 'secret';
const SERVICE_ID = '42';

const SHOP = { id: 7, name: 'Магазин', ownerId: 3, ownerTelegramId: 123456789 };

/** Тело Prepare без подписи. Подпись приписывает `sign`. */
const PREPARE = {
  click_trans_id: '1000',
  click_paydoc_id: '2000',
  service_id: SERVICE_ID,
  merchant_trans_id: '123456789',
  amount: '65000.00',
  action: '0',
  error: '0',
  sign_time: '2026-08-27 09:00:00',
};

/** Тело Complete: та же транзакция, плюс выданный нами номер счёта. */
const COMPLETE = {
  ...PREPARE,
  merchant_prepare_id: '55',
  action: '1',
  sign_time: '2026-08-27 09:00:05',
};

function sign(body: Record<string, string>): Record<string, string> {
  return { ...body, sign_string: createClickSignature(body, SECRET) };
}

interface Calls {
  reverse: string[];
  failed: Parameters<SubscriptionsService['recordFailedComplete']>[0][];
  prepare: number;
  /** Тарифы, с которыми звали `prepare`. `null` — проверка кассы. */
  preparedPlans: (string | null)[];
  complete: number;
}

interface Stubs {
  shop?: typeof SHOP | undefined;
  plan?: 'start' | 'pro' | 'max' | null;
  /** Сумма опознана как проверка кассы: тарифа нет, выдавать нечего. */
  test?: boolean;
  prepare?: PrepareResult | (() => never);
  complete?: CompleteResult | (() => never);
  reversal?: ClickReversalResult;
  secretKey?: string | undefined;
  serviceId?: string | undefined;
}

function build(stubs: Stubs = {}) {
  const calls: Calls = {
    reverse: [],
    failed: [],
    prepare: 0,
    preparedPlans: [],
    complete: 0,
  };

  const subscriptions = {
    findShopForPayment: () =>
      Promise.resolve('shop' in stubs ? stubs.shop : SHOP),
    /**
     * Разбор суммы живёт в сервисе целиком: контроллеру приходит готовое
     * «тариф такой-то», «это проверка кассы» либо «ничего». Подставляем то же,
     * что вернул бы настоящий `resolvePurchase`: тариф по цене из прайса,
     * `null` — на сумме мимо него.
     */
    resolvePurchase: () => {
      if (stubs.test) return Promise.resolve({ kind: 'test' as const });
      const plan = 'plan' in stubs ? stubs.plan : 'start';
      return Promise.resolve(plan ? { kind: 'plan' as const, plan } : null);
    },
    prepare: (input: { plan: string | null }) => {
      calls.prepare += 1;
      calls.preparedPlans.push(input.plan);
      const result = stubs.prepare ?? {
        kind: 'prepared',
        payment: { merchantBillingId: 55 },
      };
      return typeof result === 'function'
        ? Promise.reject(result())
        : Promise.resolve(result);
    },
    complete: () => {
      calls.complete += 1;
      const result = stubs.complete ?? {
        kind: 'paid',
        payment: { merchantBillingId: 55 },
        ownerId: SHOP.ownerId,
        shopName: SHOP.name,
      };
      return typeof result === 'function'
        ? Promise.reject(result())
        : Promise.resolve(result);
    },
    recordFailedComplete: (input: Calls['failed'][number]) => {
      calls.failed.push(input);
      return Promise.resolve();
    },
  } as unknown as SubscriptionsService;

  const merchant = {
    reverse: (paymentId: string) => {
      calls.reverse.push(paymentId);
      return Promise.resolve(stubs.reversal ?? { ok: true });
    },
  } as unknown as ClickMerchantService;

  const values: Record<string, unknown> = {
    'click.secretKey': 'secretKey' in stubs ? stubs.secretKey : SECRET,
    'click.serviceId': 'serviceId' in stubs ? stubs.serviceId : SERVICE_ID,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;

  return {
    controller: new ClickController(subscriptions, merchant, config),
    calls,
  };
}

describe('колбэк Click: подлинность запроса', () => {
  it('отбивает неверную подпись кодом -1', async () => {
    const { controller, calls } = build();

    const answer = await controller.handle({
      ...PREPARE,
      sign_string: '0'.repeat(32),
    });

    assert.equal(answer.error, -1);
    assert.deepEqual(calls.reverse, []);
  });

  /**
   * Главная проверка файла. Неподписанный запрос, выглядящий как оплаченный
   * Complete, не имеет права запустить возврат: Merchant API отменяет платежи в
   * границах нашей услуги, и работающая ветка означала бы, что любой желающий
   * отменяет оплаты наших продавцов, зная только номер платёжного документа.
   */
  it('не запускает возврат по неподписанному «оплаченному» Complete', async () => {
    const { controller, calls } = build();

    const answer = await controller.handle({
      ...COMPLETE,
      sign_string: '0'.repeat(32),
    });

    assert.equal(answer.error, -1);
    assert.deepEqual(calls.reverse, []);
    assert.deepEqual(calls.failed, []);
  });

  it('не принимает колбэк, если секрет подписи не задан', async () => {
    const { controller } = build({ secretKey: undefined });

    const answer = await controller.handle(sign(PREPARE));

    assert.equal(answer.error, -1);
  });

  it('отбивает чужую услугу кодом -8 и не трогает деньги', async () => {
    const { controller, calls } = build({ serviceId: '999' });

    const answer = await controller.handle(sign(COMPLETE));

    assert.equal(answer.error, -8);
    assert.deepEqual(calls.reverse, []);
    assert.deepEqual(calls.failed, []);
  });

  it('отбивает неизвестную стадию кодом -3', async () => {
    const { controller } = build();

    const answer = await controller.handle(sign({ ...PREPARE, action: '2' }));

    assert.equal(answer.error, -3);
  });

  it('возвращает идентификаторы запроса даже в отказе', async () => {
    const { controller } = build({ serviceId: '999' });

    const answer = await controller.handle(sign(COMPLETE));

    assert.equal(answer.click_trans_id, '1000');
    assert.equal(answer.merchant_trans_id, '123456789');
  });
});

describe('колбэк Click: Prepare', () => {
  it('принимает счёт и отдаёт номер счёта', async () => {
    const { controller } = build();

    const answer = await controller.handle(sign(PREPARE));

    assert.equal(answer.error, 0);
    assert.equal(answer.merchant_prepare_id, 55);
    assert.equal(answer.merchant_confirm_id, undefined);
  });

  /**
   * Click может оставить идентификатор ссылки только в `transaction_param`.
   * Вернуть пустой `merchant_trans_id` при успешном Prepare для кассы означает
   * «недостаточно информации от поставщика», хотя счёт уже принят нами.
   */
  it('возвращает transaction_param как merchant_trans_id, когда поле Click пустое', async () => {
    const { controller } = build();
    const body = {
      ...PREPARE,
      merchant_trans_id: '',
      transaction_param: PREPARE.merchant_trans_id,
    };

    const answer = await controller.handle(sign(body));

    assert.equal(answer.error, 0);
    assert.equal(answer.merchant_trans_id, PREPARE.merchant_trans_id);
    assert.equal(answer.merchant_prepare_id, 55);
  });

  it('отбивает сумму мимо прайса кодом -2, не заводя платежа', async () => {
    const { controller, calls } = build({ plan: null });

    const answer = await controller.handle(sign(PREPARE));

    assert.equal(answer.error, -2);
    assert.equal(calls.prepare, 0);
  });

  it('передаёт тариф в prepare как есть', async () => {
    const { controller, calls } = build({ plan: 'max' });

    await controller.handle(sign(PREPARE));

    assert.deepEqual(calls.preparedPlans, ['max']);
  });

  /**
   * Проверка кассы символической суммой. Счёт принимается — иначе проверять
   * было бы нечего, — но тарифа у него нет: в `prepare` уходит `null`, и это
   * единственное, чем ветка теста отличается на стадии Prepare. Всё остальное
   * (подпись, service_id, номер счёта в ответе) обязано работать ровно так же,
   * иначе тест доказывал бы не тот путь, которым пойдут настоящие деньги.
   */
  it('принимает проверку кассы, но без тарифа', async () => {
    const { controller, calls } = build({ test: true });

    const answer = await controller.handle(sign(PREPARE));

    assert.equal(answer.error, 0);
    assert.equal(answer.merchant_prepare_id, 55);
    assert.equal(calls.prepare, 1);
    assert.deepEqual(calls.preparedPlans, [null]);
  });

  it('отбивает неизвестного плательщика кодом -5 без возврата', async () => {
    const { controller, calls } = build({ shop: undefined });

    const answer = await controller.handle(sign(PREPARE));

    assert.equal(answer.error, -5);
    assert.deepEqual(calls.reverse, []);
  });

  /**
   * V1: платёжный документ уже учтён под другим номером транзакции. Сервис
   * бросает, и до списания это стоит одного кода `-8` — возвращать нечего.
   */
  it('отвечает -8 на конфликт платёжного документа и не возвращает денег', async () => {
    const { controller, calls } = build({
      prepare: () => {
        throw new Error('Платёжный документ уже учтён другим платежом');
      },
    });

    const answer = await controller.handle(sign(PREPARE));

    assert.equal(answer.error, -8);
    assert.deepEqual(calls.reverse, []);
    assert.deepEqual(calls.failed, []);
  });

  it('пересказывает отказы сервиса кодами протокола', async () => {
    for (const [kind, code] of [
      ['already_paid', -4],
      ['cancelled', -9],
      ['conflict', -8],
    ] as const) {
      const { controller } = build({ prepare: { kind } });
      const answer = await controller.handle(sign(PREPARE));
      assert.equal(answer.error, code, kind);
    }
  });
});

describe('колбэк Click: Complete', () => {
  it('подтверждает выдачу и отдаёт номер счёта', async () => {
    const { controller, calls } = build();

    const answer = await controller.handle(sign(COMPLETE));

    assert.equal(answer.error, 0);
    assert.equal(answer.merchant_confirm_id, 55);
    assert.deepEqual(calls.reverse, []);
  });

  /**
   * Законные повторы. Провайдер переспрашивает про транзакцию, с которой мы
   * уже всё решили; возврат по ним отменял бы оплаченную подписку на каждом
   * повторном колбэке.
   */
  it('не возвращает денег по повторам already_paid и cancelled', async () => {
    for (const [kind, code] of [
      ['already_paid', -4],
      ['cancelled', -9],
    ] as const) {
      const { controller, calls } = build({ complete: { kind } });
      const answer = await controller.handle(sign(COMPLETE));

      assert.equal(answer.error, code, kind);
      assert.deepEqual(calls.reverse, [], kind);
      assert.deepEqual(calls.failed, [], kind);
    }
  });

  /** B3: отказ по списанным деньгам — возврат, строка в журнале и код -9. */
  it('возвращает деньги на каждом отказе выдачи и отвечает -9', async () => {
    for (const kind of [
      'not_found',
      'invalid_amount',
      'mismatch',
      'shop_gone',
    ] as const) {
      const { controller, calls } = build({ complete: { kind } });
      const answer = await controller.handle(sign(COMPLETE));

      assert.equal(answer.error, -9, kind);
      assert.deepEqual(calls.reverse, ['2000'], kind);
      assert.equal(calls.failed.length, 1, kind);
      assert.equal(calls.failed[0].reversed, true, kind);
      assert.equal(calls.failed[0].shopId, SHOP.id, kind);
      assert.equal(calls.failed[0].amount, 65000, kind);
    }
  });

  it('отвечает -7, когда вернуть деньги не удалось', async () => {
    const { controller, calls } = build({
      complete: { kind: 'not_found' },
      reversal: { ok: false, reason: 'request_failed', detail: 'HTTP 500' },
    });

    const answer = await controller.handle(sign(COMPLETE));

    assert.equal(answer.error, -7);
    assert.equal(calls.failed[0].reversed, false);
    assert.match(calls.failed[0].reversalNote ?? '', /request_failed: HTTP 500/);
  });

  it('возвращает деньги и после исключения из сервиса', async () => {
    const { controller, calls } = build({
      complete: () => {
        throw new Error('база не ответила');
      },
    });

    const answer = await controller.handle(sign(COMPLETE));

    assert.equal(answer.error, -9);
    assert.deepEqual(calls.reverse, ['2000']);
    assert.match(calls.failed[0].errorNote, /база не ответила/);
  });

  /**
   * Магазин упразднён между стадиями: `findShopForPayment` фильтрует
   * `status = 'active'`, поэтому до ветки `shop_gone` внутри `complete()` дело
   * не доходит вовсе. Ответить одним `-5`, как на Prepare, значило бы потерять
   * уже списанные деньги молча.
   */
  it('возвращает деньги, если плательщик Complete не разрешился в магазин', async () => {
    const { controller, calls } = build({ shop: undefined });

    const answer = await controller.handle(sign(COMPLETE));

    assert.equal(answer.error, -9);
    assert.deepEqual(calls.reverse, ['2000']);
    assert.equal(calls.failed[0].shopId, null);
    assert.equal(calls.complete, 0);
  });

  /**
   * Complete с отрицательным кодом — уведомление об отмене на стороне Click:
   * деньги по нему не списывались, и возвращать нечего.
   */
  it('не возвращает денег по отказу на отменённом Complete', async () => {
    const { controller, calls } = build({ complete: { kind: 'not_found' } });

    const answer = await controller.handle(
      sign({ ...COMPLETE, error: '-5' }),
    );

    assert.equal(answer.error, -6);
    assert.deepEqual(calls.reverse, []);
    assert.deepEqual(calls.failed, []);
  });
});
