import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { SubscriptionPayment, SubscriptionPaymentMeta } from '../../db/schema';
import { PaymeService } from './payme.service';
import { PaymeRpcError, PAYME_STATE, PAYME_TIMEOUT_MS } from './payme-protocol';
import type { SubscriptionsRepository } from './subscriptions.repository';
import type { SubscriptionsService } from './subscriptions.service';

const ORDER_ID = 100042;
const AMOUNT_UZS = 65_000;
const AMOUNT_TIYIN = 6_500_000;
const TXN = '62b1c2e4a9d3f000123abcde';
const NOW = 1_800_000_000_000;

const CONFIG: Record<string, unknown> = {
  'payme.merchantId': 'merchant-1',
  'payme.key': 'secret',
  'payme.checkoutUrl': 'https://checkout.paycom.uz',
  'payme.accountField': 'order_id',
  'payme.sandboxTtlMin': 720,
  'payme.fiscal.ikpu': '10305001001000000',
  'payme.fiscal.packageCode': '1513162',
  'payme.fiscal.vatPercent': 12,
  'payme.fiscal.receiptType': 0,
};

interface Options {
  status?: SubscriptionPayment['status'];
  provider?: SubscriptionPayment['provider'];
  shopStatus?: string;
  meta?: SubscriptionPaymentMeta;
  providerTransactionId?: string | null;
  createdAtMs?: number;
  test?: boolean;
  ikpu?: string | undefined;
  packageCode?: string | undefined;
}

function build(options: Options = {}) {
  const payment = {
    id: 11,
    shopId: 7,
    provider: options.provider ?? 'payme',
    plan: options.test ? 'free' : 'pro',
    amount: AMOUNT_UZS,
    status: options.status ?? 'pending',
    providerTransactionId: options.providerTransactionId ?? null,
    providerPaymentId: null,
    providerPrepareId: null,
    merchantBillingId: ORDER_ID,
    activatedFrom: null,
    activatedUntil: null,
    grantedCredits: null,
    burnedCredits: null,
    paidAt: null,
    cancelledAt: null,
    initiatorId: null,
    meta: { ...(options.test ? { test: true } : {}), ...options.meta },
    createdAt: new Date(options.createdAtMs ?? NOW - 60_000),
    updatedAt: new Date(NOW),
  } as unknown as SubscriptionPayment;

  const calls = { settled: 0, notified: 0 };

  const repository = {
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
    lockByBillingId: (_tx: unknown, billingId: number) =>
      Promise.resolve(billingId === ORDER_ID ? payment : undefined),
    findOrderWithShop: (billingId: number) =>
      Promise.resolve(
        billingId === ORDER_ID
          ? {
              payment,
              shopName: 'Магазин',
              shopStatus: options.shopStatus ?? 'active',
              ownerId: 3,
            }
          : undefined,
      ),
    lockShop: () =>
      Promise.resolve({
        id: payment.shopId,
        name: 'Магазин',
        owner: 3,
        status: options.shopStatus ?? 'active',
        subscriptionPlan: 'free',
        subscriptionUntil: null,
      }),
    lockByProviderTransaction: (
      _tx: unknown,
      _provider: string,
      id: string,
    ) =>
      Promise.resolve(payment.providerTransactionId === id ? payment : undefined),
    findPaymeByTransaction: (id: string) =>
      Promise.resolve(payment.providerTransactionId === id ? payment : undefined),
    findPaymeStatement: () => Promise.resolve([payment]),
    attachPaymeTransaction: (
      _tx: unknown,
      _id: number,
      data: { providerTransactionId: string; meta: SubscriptionPaymentMeta },
    ) => {
      payment.providerTransactionId = data.providerTransactionId;
      payment.status = 'prepared';
      payment.meta = { ...payment.meta, ...data.meta };
      return Promise.resolve(payment);
    },
    markCancelled: (
      _tx: unknown,
      _id: number,
      meta: SubscriptionPaymentMeta,
    ) => {
      payment.status = 'cancelled';
      payment.meta = { ...payment.meta, ...meta };
      return Promise.resolve(payment);
    },
    patchMeta: (_tx: unknown, _id: number, meta: SubscriptionPaymentMeta) => {
      payment.meta = { ...payment.meta, ...meta };
      return Promise.resolve(payment);
    },
  } as unknown as SubscriptionsRepository;

  const subscriptions = {
    paymeAccountField: () => 'order_id',
    testWindowMinutes: () => 720,
    settlePaidOrder: (
      _tx: unknown,
      target: SubscriptionPayment,
      shop: { name: string; owner: number },
    ) => {
      calls.settled += 1;
      target.status = 'paid';
      target.paidAt = new Date(NOW);
      return Promise.resolve({
        kind: 'paid' as const,
        payment: target,
        ownerId: shop.owner,
        shopName: shop.name,
        test: target.meta?.test === true,
      });
    },
    notifyGranted: () => {
      calls.notified += 1;
    },
  } as unknown as SubscriptionsService;

  const config = {
    get: (key: string) =>
      key === 'payme.fiscal.ikpu' && 'ikpu' in options
        ? options.ikpu
        : key === 'payme.fiscal.packageCode' && 'packageCode' in options
          ? options.packageCode
        : CONFIG[key],
  } as unknown as ConfigService;

  return {
    service: new PaymeService(repository, subscriptions, config),
    payment,
    calls,
  };
}

async function expectError(code: number, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof PaymeRpcError, 'ожидалась ошибка протокола');
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`ожидалась ошибка ${code}, но её не было`);
}

const account = { order_id: String(ORDER_ID) };

describe('CheckPerformTransaction', () => {
  it('разрешает оплату и отдаёт фискальный чек на всю сумму', async () => {
    const { service } = build();

    const result = (await service.handle('CheckPerformTransaction', {
      amount: AMOUNT_TIYIN,
      account,
    })) as { allow: boolean; detail?: { items: { price: number }[] } };

    assert.equal(result.allow, true);
    assert.equal(result.detail?.items[0].price, AMOUNT_TIYIN);
  });

  it('без ИКПУ отвечает без detail — чек собирает касса', async () => {
    const { service } = build({ ikpu: undefined });

    const result = (await service.handle('CheckPerformTransaction', {
      amount: AMOUNT_TIYIN,
      account,
    })) as { allow: boolean; detail?: unknown };

    assert.equal(result.allow, true);
    assert.equal(result.detail, undefined);
  });

  it('отбивает чужую сумму кодом -31001', async () => {
    const { service } = build();
    await expectError(-31001, () =>
      service.handle('CheckPerformTransaction', {
        amount: AMOUNT_TIYIN - 1,
        account,
      }),
    );
  });

  it('отбивает несуществующий заказ кодом -31050', async () => {
    const { service } = build();
    await expectError(-31050, () =>
      service.handle('CheckPerformTransaction', {
        amount: AMOUNT_TIYIN,
        account: { order_id: '999' },
      }),
    );
  });

  it('отбивает оплаченный заказ кодом -31008', async () => {
    const { service } = build({ status: 'paid' });
    await expectError(-31008, () =>
      service.handle('CheckPerformTransaction', {
        amount: AMOUNT_TIYIN,
        account,
      }),
    );
  });

  it('отбивает заказ упразднённого магазина кодом -31051', async () => {
    const { service } = build({ shopStatus: 'abolished' });
    await expectError(-31051, () =>
      service.handle('CheckPerformTransaction', {
        amount: AMOUNT_TIYIN,
        account,
      }),
    );
  });
});

describe('CreateTransaction', () => {
  const params = {
    id: TXN,
    time: NOW,
    amount: AMOUNT_TIYIN,
    account,
  };

  it('заводит транзакцию в состоянии 1', async () => {
    const { service, payment } = build();

    const result = (await service.handle('CreateTransaction', params)) as {
      state: number;
      transaction: string;
    };

    assert.equal(result.state, PAYME_STATE.created);
    assert.equal(result.transaction, String(payment.id));
    assert.equal(payment.providerTransactionId, TXN);
    assert.equal(payment.status, 'prepared');
  });

  it('повторный вызов возвращает ту же транзакцию', async () => {
    const { service } = build();

    const first = (await service.handle('CreateTransaction', params)) as {
      create_time: number;
    };
    const second = (await service.handle('CreateTransaction', params)) as {
      create_time: number;
      state: number;
    };

    assert.equal(second.create_time, first.create_time);
    assert.equal(second.state, PAYME_STATE.created);
  });

  it('повторный вызов с другой суммой отвечает -31001', async () => {
    const { service } = build();

    await service.handle('CreateTransaction', params);
    await expectError(-31001, () =>
      service.handle('CreateTransaction', {
        ...params,
        amount: AMOUNT_TIYIN + 1,
      }),
    );
  });

  it('вторую транзакцию по тому же заказу отбивает кодом -31008', async () => {
    const { service } = build({
      status: 'prepared',
      providerTransactionId: 'другая-транзакция',
      meta: { paymeState: PAYME_STATE.created, paymeCreateTime: NOW },
    });

    await expectError(-31008, () => service.handle('CreateTransaction', params));
  });

  it('просроченную транзакцию отменяет и отбивает кодом -31008', async () => {
    const { service, payment } = build({
      status: 'prepared',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.created,
        paymeCreateTime: Date.now() - PAYME_TIMEOUT_MS - 1000,
      },
    });

    await expectError(-31008, () => service.handle('CreateTransaction', params));
    assert.equal(payment.status, 'cancelled');
    assert.equal(payment.meta?.paymeState, PAYME_STATE.cancelled);
    assert.equal(payment.meta?.paymeReason, 4);
  });
});

describe('PerformTransaction', () => {
  it('выдаёт подписку и переводит транзакцию в состояние 2', async () => {
    const { service, payment, calls } = build({
      status: 'prepared',
      providerTransactionId: TXN,
      meta: { paymeState: PAYME_STATE.created, paymeCreateTime: Date.now() },
    });

    const result = (await service.handle('PerformTransaction', {
      id: TXN,
    })) as { state: number; perform_time: number };

    assert.equal(result.state, PAYME_STATE.performed);
    assert.ok(result.perform_time > 0);
    assert.equal(calls.settled, 1);
    assert.equal(calls.notified, 1);
    assert.equal(payment.status, 'paid');
  });

  it('повторный вызов не выдаёт подписку второй раз', async () => {
    const { service, calls } = build({
      status: 'paid',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.performed,
        paymePerformTime: NOW,
        paymeCreateTime: NOW,
      },
    });

    const result = (await service.handle('PerformTransaction', {
      id: TXN,
    })) as { state: number; perform_time: number };

    assert.equal(result.state, PAYME_STATE.performed);
    assert.equal(result.perform_time, NOW);
    assert.equal(calls.settled, 0);
  });

  it('по отменённой транзакции отвечает -31008', async () => {
    const { service } = build({
      status: 'cancelled',
      providerTransactionId: TXN,
      meta: { paymeState: PAYME_STATE.cancelled, paymeCreateTime: NOW },
    });

    await expectError(-31008, () =>
      service.handle('PerformTransaction', { id: TXN }),
    );
  });

  it('по неизвестной транзакции отвечает -31003', async () => {
    const { service } = build();
    await expectError(-31003, () =>
      service.handle('PerformTransaction', { id: 'нет-такой' }),
    );
  });

  it('просроченную транзакцию отменяет и подписку не выдаёт', async () => {
    const { service, payment, calls } = build({
      status: 'prepared',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.created,
        paymeCreateTime: Date.now() - PAYME_TIMEOUT_MS - 1000,
      },
    });

    await expectError(-31008, () =>
      service.handle('PerformTransaction', { id: TXN }),
    );
    assert.equal(calls.settled, 0);
    assert.equal(payment.status, 'cancelled');
    assert.equal(payment.meta?.paymeReason, 4);
  });
});

describe('CancelTransaction', () => {
  it('отменяет неоплаченную транзакцию в состояние -1', async () => {
    const { service, payment } = build({
      status: 'prepared',
      providerTransactionId: TXN,
      meta: { paymeState: PAYME_STATE.created, paymeCreateTime: NOW },
    });

    const result = (await service.handle('CancelTransaction', {
      id: TXN,
      reason: 3,
    })) as { state: number; cancel_time: number };

    assert.equal(result.state, PAYME_STATE.cancelled);
    assert.ok(result.cancel_time > 0);
    assert.equal(payment.status, 'cancelled');
    assert.equal(payment.meta?.paymeReason, 3);
  });

  it('выполненную транзакцию не отменяет — отвечает -31007', async () => {
    const { service, payment } = build({
      status: 'paid',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.performed,
        paymePerformTime: NOW,
        paymeCreateTime: NOW,
      },
    });

    await expectError(-31007, () =>
      service.handle('CancelTransaction', { id: TXN, reason: 5 }),
    );
    assert.equal(payment.status, 'paid');
  });

  it('повторная отмена возвращает то же время отмены', async () => {
    const { service } = build({
      status: 'cancelled',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.cancelled,
        paymeCancelTime: NOW,
        paymeReason: 4,
        paymeCreateTime: NOW,
      },
    });

    const result = (await service.handle('CancelTransaction', {
      id: TXN,
      reason: 4,
    })) as { state: number; cancel_time: number };

    assert.equal(result.state, PAYME_STATE.cancelled);
    assert.equal(result.cancel_time, NOW);
  });
});

describe('CheckTransaction и GetStatement', () => {
  it('отдаёт состояние транзакции', async () => {
    const { service, payment } = build({
      status: 'paid',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.performed,
        paymeCreateTime: NOW,
        paymePerformTime: NOW + 1000,
      },
    });

    const result = (await service.handle('CheckTransaction', {
      id: TXN,
    })) as { state: number; create_time: number; transaction: string };

    assert.equal(result.state, PAYME_STATE.performed);
    assert.equal(result.create_time, NOW);
    assert.equal(result.transaction, String(payment.id));
  });

  it('по неизвестной транзакции отвечает -31003', async () => {
    const { service } = build();
    await expectError(-31003, () =>
      service.handle('CheckTransaction', { id: 'нет-такой' }),
    );
  });

  it('выписка отдаёт сумму в тийинах и номер заказа в account', async () => {
    const { service } = build({
      status: 'paid',
      providerTransactionId: TXN,
      meta: {
        paymeState: PAYME_STATE.performed,
        paymeCreateTime: NOW,
        paymeTime: NOW,
        paymePerformTime: NOW,
      },
    });

    const result = (await service.handle('GetStatement', {
      from: NOW - 1000,
      to: NOW + 1000,
    })) as {
      transactions: {
        id: string;
        amount: number;
        account: Record<string, string>;
      }[];
    };

    assert.equal(result.transactions.length, 1);
    assert.equal(result.transactions[0].amount, AMOUNT_TIYIN);
    assert.equal(result.transactions[0].id, TXN);
    assert.equal(result.transactions[0].account.order_id, String(ORDER_ID));
  });
});
