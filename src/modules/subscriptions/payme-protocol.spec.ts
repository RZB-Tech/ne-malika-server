import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PAYME_STATE,
  PaymeRpcError,
  buildFiscalDetail,
  createPaymeCheckoutUrl,
  paramAmountTiyin,
  paramOrderId,
  paramReason,
  paramTime,
  paramTransactionId,
  parsePaymeRequest,
  requestId,
  tiyinToUzs,
  uzsToTiyin,
  verifyPaymeAuth,
} from './payme-protocol';

function basic(login: string, password: string): string {
  return 'Basic ' + Buffer.from(login + ':' + password).toString('base64');
}

function expectError(code: number, fn: () => unknown): PaymeRpcError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PaymeRpcError, 'ожидалась ошибка протокола');
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`ожидалась ошибка ${code}, но её не было`);
}

describe('авторизация Payme', () => {
  it('пускает только Paycom с ключом кассы', () => {
    assert.equal(verifyPaymeAuth(basic('Paycom', 'secret'), 'secret'), true);
    assert.equal(verifyPaymeAuth(basic('Paycom', 'other'), 'secret'), false);
    assert.equal(verifyPaymeAuth(basic('paycom', 'secret'), 'secret'), false);
  });

  it('отбивает пустой и кривой заголовок', () => {
    assert.equal(verifyPaymeAuth(undefined, 'secret'), false);
    assert.equal(verifyPaymeAuth('Bearer token', 'secret'), false);
    assert.equal(verifyPaymeAuth('Basic', 'secret'), false);
    assert.equal(verifyPaymeAuth(basic('Paycom', 'secret'), undefined), false);
  });

  it('не пускает никого, пока ключ не задан', () => {
    assert.equal(verifyPaymeAuth(basic('Paycom', ''), ''), false);
  });
});

describe('разбор запроса Payme', () => {
  it('принимает известный метод с параметрами', () => {
    const request = parsePaymeRequest({
      method: 'CheckPerformTransaction',
      params: { amount: 100, account: { order_id: '1' } },
      id: 7,
    });

    assert.equal(request.method, 'CheckPerformTransaction');
    assert.equal(request.id, 7);
  });

  it('отбивает чужой метод кодом -32601', () => {
    expectError(-32601, () =>
      parsePaymeRequest({ method: 'DropDatabase', params: {}, id: 1 }),
    );
  });

  it('отбивает запрос без params кодом -32600', () => {
    expectError(-32600, () =>
      parsePaymeRequest({ method: 'CheckTransaction', id: 1 }),
    );
    expectError(-32600, () => parsePaymeRequest('строка'));
  });

  it('достаёт id даже из битого тела — ответ обязан его вернуть', () => {
    assert.equal(requestId({ id: 42 }), 42);
    assert.equal(requestId({ id: 'abc' }), 'abc');
    assert.equal(requestId(null), null);
  });
});

describe('параметры методов', () => {
  it('требует непустой идентификатор транзакции', () => {
    assert.equal(paramTransactionId({ id: ' 62a1c ' }), '62a1c');
    expectError(-32600, () => paramTransactionId({ id: 12 }));
  });

  it('отбивает неположительную сумму кодом -31001', () => {
    assert.equal(paramAmountTiyin({ amount: 100500 }), 100500);
    expectError(-31001, () => paramAmountTiyin({ amount: 0 }));
    expectError(-31001, () => paramAmountTiyin({ amount: '100' }));
  });

  it('читает номер заказа из настроенного поля account', () => {
    assert.equal(paramOrderId({ account: { order_id: '100042' } }, 'order_id'), 100042);
    assert.equal(paramOrderId({ account: { order_id: 100042 } }, 'order_id'), 100042);
  });

  it('отбивает кривой account кодом -31050 с именем поля', () => {
    const error = expectError(-31050, () =>
      paramOrderId({ account: { order_id: 'abc' } }, 'order_id'),
    );
    assert.equal(error.data, 'order_id');

    expectError(-31050, () => paramOrderId({}, 'order_id'));
    expectError(-31050, () =>
      paramOrderId({ account: { other: '1' } }, 'order_id'),
    );
  });

  it('читает время и причину отмены', () => {
    assert.equal(paramTime({ time: 1_700_000_000_000 }, 'time'), 1_700_000_000_000);
    expectError(-32600, () => paramTime({ time: '1' }, 'time'));
    assert.equal(paramReason({ reason: 5 }), 5);
    assert.equal(paramReason({}), null);
  });
});

describe('деньги', () => {
  it('переводит сумы в тийины и обратно', () => {
    assert.equal(uzsToTiyin(65_000), 6_500_000);
    assert.equal(uzsToTiyin(1000.5), 100_050);
    assert.equal(tiyinToUzs(6_500_000), 65_000);
  });
});

describe('фискальный чек', () => {
  it('собирает позицию так, чтобы price * count сошлось с суммой', () => {
    const detail = buildFiscalDetail({
      title: 'Подписка neMalika PRO',
      amountTiyin: 13_000_000,
      ikpu: '10305001001000000',
      packageCode: '1513162',
      vatPercent: 12,
      receiptType: 0,
    });

    assert.ok(detail);
    assert.equal(detail.receipt_type, 0);
    assert.equal(detail.items.length, 1);

    const [item] = detail.items;
    assert.equal(item.price * item.count, 13_000_000);
    assert.equal(item.code, '10305001001000000');
    assert.equal(item.package_code, '1513162');
    assert.equal(item.vat_percent, 12);
  });

  it('без ИКПУ чек не собирается — фискальные данные заливает касса', () => {
    assert.equal(
      buildFiscalDetail({
        title: 'Подписка',
        amountTiyin: 100_000,
        vatPercent: 12,
        receiptType: 0,
      }),
      undefined,
    );
  });
});

describe('ссылка на кассу', () => {
  it('кодирует параметры base64 через точку с запятой', () => {
    const url = createPaymeCheckoutUrl({
      checkoutUrl: 'https://checkout.paycom.uz/',
      merchantId: '587f72c72cac0d162c722ae2',
      accountField: 'order_id',
      orderId: 197,
      amountTiyin: 500,
      lang: 'ru',
    });

    const encoded = url.split('/').pop() ?? '';
    assert.equal(
      Buffer.from(encoded, 'base64').toString('utf8'),
      'm=587f72c72cac0d162c722ae2;ac.order_id=197;a=500;l=ru',
    );
    assert.ok(url.startsWith('https://checkout.paycom.uz/'));
  });

  it('добавляет адрес возврата, когда он задан', () => {
    const url = createPaymeCheckoutUrl({
      checkoutUrl: 'https://test.paycom.uz',
      merchantId: 'm1',
      accountField: 'order_id',
      orderId: 1,
      amountTiyin: 100,
      callbackUrl: 'https://nemalika.uz/seller/subscription',
    });

    const decoded = Buffer.from(url.split('/').pop() ?? '', 'base64').toString(
      'utf8',
    );
    assert.ok(decoded.includes('c=https://nemalika.uz/seller/subscription'));
  });
});

describe('состояния транзакции', () => {
  it('совпадают с протоколом', () => {
    assert.deepEqual(PAYME_STATE, {
      created: 1,
      performed: 2,
      cancelled: -1,
      cancelledAfterPerform: -2,
    });
  });
});
