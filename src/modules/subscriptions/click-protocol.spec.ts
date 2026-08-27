import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createClickMerchantAuth,
  createClickPaymentUrl,
  createClickSignature,
  parseClickCallback,
  verifyClickSignature,
} from './click-protocol';

const PREPARE_BODY = {
  click_trans_id: '123456789',
  click_paydoc_id: '987654321',
  service_id: '42',
  merchant_trans_id: 'user-1',
  amount: '15000.00',
  action: '0',
  error: '0',
  sign_time: '2026-08-22 12:34:56',
};

const COMPLETE_BODY = {
  ...PREPARE_BODY,
  merchant_prepare_id: '77',
  action: '1',
  sign_time: '2026-08-22 12:35:00',
};

describe('подпись Click', () => {
  it('считает и сверяет подпись Prepare', () => {
    const signature = createClickSignature(PREPARE_BODY, 'secret');

    assert.equal(signature, 'a7c958fd3ece03bd8d90c836bd136df4');
    assert.equal(
      verifyClickSignature(
        { ...PREPARE_BODY, sign_string: signature },
        'secret',
      ),
      true,
    );
    assert.equal(
      verifyClickSignature(
        { ...PREPARE_BODY, sign_string: signature },
        'wrong',
      ),
      false,
    );
  });

  it('включает merchant_prepare_id в подпись Complete', () => {
    assert.equal(
      createClickSignature(COMPLETE_BODY, 'secret'),
      'f1ddc808ff215c27bf838b10b1294749',
    );
    assert.notEqual(
      createClickSignature(
        { ...COMPLETE_BODY, merchant_prepare_id: '78' },
        'secret',
      ),
      createClickSignature(COMPLETE_BODY, 'secret'),
    );
  });

  it('даёт разные подписи для одинакового тела с разным action', () => {
    assert.notEqual(
      createClickSignature({ ...COMPLETE_BODY, action: '0' }, 'secret'),
      createClickSignature(COMPLETE_BODY, 'secret'),
    );
  });

  it('сверяет подпись без учёта регистра', () => {
    const signature = createClickSignature(PREPARE_BODY, 'secret');

    assert.equal(
      verifyClickSignature(
        { ...PREPARE_BODY, sign_string: signature.toUpperCase() },
        'secret',
      ),
      true,
    );
  });

  it('не падает на подписи произвольной длины', () => {
    for (const signString of ['', 'abc', 'a'.repeat(31), 'a'.repeat(64)]) {
      assert.equal(
        verifyClickSignature(
          { ...PREPARE_BODY, sign_string: signString },
          'secret',
        ),
        false,
        signString,
      );
    }
  });

  it('отказывает при пустом секрете', () => {
    const signature = createClickSignature(PREPARE_BODY, '');

    assert.equal(
      verifyClickSignature({ ...PREPARE_BODY, sign_string: signature }, ''),
      false,
    );
  });
});

describe('разбор колбэка Click', () => {
  it('разбирает корректный Prepare', () => {
    const signString = createClickSignature(PREPARE_BODY, 'secret');

    assert.deepEqual(
      parseClickCallback({ ...PREPARE_BODY, sign_string: signString }),
      {
        clickTransId: '123456789',
        clickPaydocId: '987654321',
        serviceId: '42',
        merchantTransId: 'user-1',
        merchantPrepareId: '',
        amount: 15_000,
        amountText: '15000.00',
        action: 0,
        clickError: 0,
        signTime: '2026-08-22 12:34:56',
        signString,
      },
    );
  });

  it('сохраняет присланный текст суммы рядом с числом', () => {
    const body = { ...PREPARE_BODY, amount: '15000' };
    const parsed = parseClickCallback({
      ...body,
      sign_string: createClickSignature(body, 'secret'),
    });

    assert.equal(parsed?.amount, 15_000);
    assert.equal(parsed?.amountText, '15000');
  });

  it('разбирает корректный Complete вместе с merchant_prepare_id', () => {
    const parsed = parseClickCallback({
      ...COMPLETE_BODY,
      sign_string: createClickSignature(COMPLETE_BODY, 'secret'),
    });

    assert.equal(parsed?.action, 1);
    assert.equal(parsed?.merchantPrepareId, '77');
  });

  it('отбраковывает Complete без merchant_prepare_id', () => {
    const signString = createClickSignature(
      { ...PREPARE_BODY, action: '1' },
      'secret',
    );

    assert.equal(
      parseClickCallback({
        ...PREPARE_BODY,
        action: '1',
        sign_string: signString,
      }),
      null,
    );
    assert.equal(
      parseClickCallback({
        ...COMPLETE_BODY,
        merchant_prepare_id: 'abc',
        sign_string: signString,
      }),
      null,
    );
  });

  it('отбраковывает пропущенные, кривые и слишком точные поля', () => {
    const signString = createClickSignature(PREPARE_BODY, 'secret');
    const broken: Array<[string, Record<string, unknown>]> = [
      ['нет error', { ...PREPARE_BODY, error: undefined }],
      ['три знака в сумме', { ...PREPARE_BODY, amount: '15000.001' }],
      ['сумма не число', { ...PREPARE_BODY, amount: 'много' }],
      ['нулевая сумма', { ...PREPARE_BODY, amount: '0' }],
      ['paydoc не число', { ...PREPARE_BODY, click_paydoc_id: 'not-a-number' }],
      ['trans_id не число', { ...PREPARE_BODY, click_trans_id: '12a' }],
      ['service_id не число', { ...PREPARE_BODY, service_id: 'svc' }],
      [
        'пустой merchant_trans_id и нет transaction_param',
        { ...PREPARE_BODY, merchant_trans_id: '   ' },
      ],
      ['нет sign_time', { ...PREPARE_BODY, sign_time: '' }],
      ['неизвестный action', { ...PREPARE_BODY, action: '2' }],
      ['action не число', { ...PREPARE_BODY, action: 'prepare' }],
      ['error не число', { ...PREPARE_BODY, error: '0.5' }],
      ['короткая подпись', { ...PREPARE_BODY, sign_string: 'deadbeef' }],
      ['подпись не hex', { ...PREPARE_BODY, sign_string: 'z'.repeat(32) }],
    ];

    for (const [name, body] of broken) {
      assert.equal(
        parseClickCallback({ sign_string: signString, ...body }),
        null,
        name,
      );
    }
  });

  it('берёт transaction_param, когда merchant_trans_id пуст', () => {
    const signString = createClickSignature(PREPARE_BODY, 'secret');

    const parsed = parseClickCallback({
      sign_string: signString,
      ...PREPARE_BODY,
      merchant_trans_id: '',
      transaction_param: 'user-1',
    });

    assert.equal(parsed?.merchantTransId, 'user-1');
  });

  it('не даёт transaction_param перебить непустой merchant_trans_id', () => {
    const signString = createClickSignature(PREPARE_BODY, 'secret');

    const parsed = parseClickCallback({
      sign_string: signString,
      ...PREPARE_BODY,
      transaction_param: 'подменённое-значение',
    });

    assert.equal(parsed?.merchantTransId, 'user-1');
  });

  it('пропускает отрицательный код провайдера', () => {
    const body = { ...PREPARE_BODY, error: '-5017' };
    const parsed = parseClickCallback({
      ...body,
      sign_string: createClickSignature(body, 'secret'),
    });

    assert.equal(parsed?.clickError, -5017);
  });

  it('обрезает пробелы по краям значений', () => {
    const signString = createClickSignature(PREPARE_BODY, 'secret');
    const parsed = parseClickCallback({
      ...PREPARE_BODY,
      click_trans_id: ' 123456789 ',
      merchant_trans_id: ' user-1 ',
      sign_string: ` ${signString} `,
    });

    assert.equal(parsed?.clickTransId, '123456789');
    assert.equal(parsed?.merchantTransId, 'user-1');
    assert.equal(parsed?.signString, signString);
  });
});

describe('Merchant API', () => {
  it('собирает заголовок Auth по схеме merchant_user_id:sha1(timestamp+secret):timestamp', () => {
    assert.equal(
      createClickMerchantAuth(
        'merchant-user',
        'merchant-secret',
        1_700_000_000,
      ),
      'merchant-user:365ed00fc132f380c05fdb689f21bd9148cbb5c9:1700000000',
    );
  });
});

describe('ссылка на кассу Click', () => {
  it('передаёт сумму двумя знаками и кодирует параметр платежа', () => {
    const url = new URL(
      createClickPaymentUrl({
        serviceId: '42',
        merchantId: '7',
        amountUzs: 65_000,
        transactionParam: 'user 1',
      }),
    );

    assert.equal(
      url.origin + url.pathname,
      'https://my.click.uz/services/pay/',
    );
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      service_id: '42',
      merchant_id: '7',
      amount: '65000.00',
      transaction_param: 'user 1',
    });
  });

  it('строит адрес кассы ровно так, как в примерах Android и iOS', () => {
    const url = createClickPaymentUrl({
      serviceId: '110383',
      merchantId: '58112',
      amountUzs: 1000,
      transactionParam: '100002',
    });

    assert.equal(
      url,
      'https://my.click.uz/services/pay/?service_id=110383&merchant_id=58112&amount=1000.00&transaction_param=100002',
    );
    assert.ok(url.includes('/services/pay/?'));
  });

  it('не даёт параметру платежа развалить строку запроса', () => {
    const url = new URL(
      createClickPaymentUrl({
        serviceId: '42',
        merchantId: '7',
        amountUzs: 65_000,
        transactionParam: '1&amount=1',
        returnUrl: 'https://nemalika.uz/seller/subscription',
      }),
    );

    assert.equal(url.searchParams.get('amount'), '65000.00');
    assert.equal(url.searchParams.get('transaction_param'), '1&amount=1');
    assert.equal(
      url.searchParams.get('return_url'),
      'https://nemalika.uz/seller/subscription',
    );
  });

  it('не подставляет пустой return_url', () => {
    const url = new URL(
      createClickPaymentUrl({
        serviceId: '42',
        merchantId: '7',
        amountUzs: 130_000,
        transactionParam: '123456789',
      }),
    );

    assert.equal(url.searchParams.has('return_url'), false);
  });
});
