import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAutofillResult } from './product-autofill.types';
import {
  autofillOutcome,
  ProductAutofillService,
} from './product-autofill.service';
import { AUTOFILL_MAX_CHARACTERISTICS } from './dto/product-autofill.dto';

const CATEGORIES = new Set([12, 34]);

function parse(payload: unknown) {
  return parseAutofillResult(JSON.stringify(payload), CATEGORIES);
}

describe('product autofill response parsing', () => {
  it('keeps the model order and drops duplicate keys', () => {
    const result = parse({
      description: 'Ноутбук в хорошем состоянии',
      characteristics: [
        { key: 'Процессор', value: 'Apple M2' },
        { key: 'процессор:', value: 'Intel i5' },
        { key: 'ОЗУ', value: '8 ГБ' },
      ],
    });

    assert.deepEqual(result.characteristics, [
      { key: 'Процессор', value: 'Apple M2' },
      { key: 'ОЗУ', value: '8 ГБ' },
    ]);
  });

  it('drops brand, model and fields that belong elsewhere in the card', () => {
    const result = parse({
      description: 'Клавиатура',
      brand: 'Logitech',
      characteristics: [
        { key: 'Бренд', value: 'Logitech' },
        { key: 'Модель', value: 'K380' },
        { key: 'Цена', value: '300 000' },
        { key: 'Состояние', value: 'новый' },
        { key: 'Telegram', value: '@seller' },
        { key: 'Подсветка', value: 'RGB' },
      ],
    });

    assert.deepEqual(result.characteristics, [
      { key: 'Подсветка', value: 'RGB' },
    ]);
    assert.equal(result.brand, 'Logitech');
  });

  it('ignores a category the shop cannot use', () => {
    assert.equal(parse({ description: 'Мышь', categoryId: 12 }).categoryId, 12);
    assert.equal(
      parse({ description: 'Мышь', categoryId: 99 }).categoryId,
      null,
    );
  });

  it('treats an unclear condition as unknown rather than guessing', () => {
    assert.equal(parse({ description: 'Мышь', state: 'new' }).state, 'new');
    assert.equal(
      parse({ description: 'Мышь', state: 'возможно новый' }).state,
      null,
    );
    assert.equal(parse({ description: 'Мышь' }).state, null);
  });

  it('reads a fenced answer, because models wrap JSON in a code block', () => {
    const result = parseAutofillResult(
      '```json\n{"description":"Монитор 27 дюймов"}\n```',
      CATEGORIES,
    );
    assert.equal(result.description, 'Монитор 27 дюймов');
  });

  it('normalises the words models use instead of an empty brand', () => {
    assert.equal(parse({ description: 'Кабель', brand: 'null' }).brand, null);
    assert.equal(parse({ description: 'Кабель', brand: '—' }).brand, null);
    assert.equal(
      parse({ description: 'Кабель', brand: ' Anker ' }).brand,
      'Anker',
    );
  });

  it('caps the list so the model cannot pad it with filler', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      key: `Параметр ${i}`,
      value: `Значение ${i}`,
    }));
    assert.equal(
      parse({ description: '', characteristics: many }).characteristics.length,
      AUTOFILL_MAX_CHARACTERISTICS,
    );
  });

  it('fails instead of charging for an answer with nothing in it', () => {
    assert.throws(
      () => parse({ description: '', characteristics: [] }),
      /ни одного поля/,
    );
    assert.throws(() => parseAutofillResult('не json', CATEGORIES), /JSON/);
  });

  it('normalises a parameter map instead of silently discarding it', () => {
    const result = parse({
      description: 'Ноутбук',
      characteristics: {
        Процессор: 'Ryzen 5',
        Накопитель: 'SSD 512 ГБ',
        Видеопамять: '8 ГБ',
        Разъёмы: ['USB-C', 'HDMI'],
        'Количество портов': 3,
        Цена: '100000',
        ОЗУ: null,
        Частота: { unknown: true },
      },
    });
    assert.deepEqual(result.characteristics, [
      { key: 'Процессор', value: 'Ryzen 5' },
      { key: 'Накопитель', value: 'SSD 512 ГБ' },
      { key: 'Видеопамять', value: '8 ГБ' },
      { key: 'Разъёмы', value: 'USB-C, HDMI' },
      { key: 'Количество портов', value: '3' },
    ]);
  });

  it('accepts named rows and drops malformed or unknown values', () => {
    assert.deepEqual(
      parse({
        description: 'Ноутбук',
        characteristics: [
          { name: 'Накопитель', value: 'SSD 512 ГБ' },
          null,
          false,
          'не строка параметра',
          { key: 'ОЗУ', value: 'неизвестно' },
          { key: 'Цвет', value: 'чёрный' },
        ],
      }).characteristics,
      [
        { key: 'Накопитель', value: 'SSD 512 ГБ' },
        { key: 'Цвет', value: 'чёрный' },
      ],
    );
  });

  it('copies explicitly labelled technical facts out of the description', () => {
    const result = parse({
      description:
        'Ноутбук для работы.\n\n- **Процессор:** Ryzen 5\n- **Накопитель:** SSD 512 ГБ\n- **Видеопамять:** 8 ГБ\n- **Цена:** 100000\n- **Гарантия:** 2 года',
      characteristics: [],
    });
    assert.deepEqual(result.characteristics, [
      { key: 'Процессор', value: 'Ryzen 5' },
      { key: 'Накопитель', value: 'SSD 512 ГБ' },
      { key: 'Видеопамять', value: '8 ГБ' },
    ]);
  });

  it('does not infer configuration from a model name or turn prose into specs', () => {
    assert.deepEqual(
      parse({
        description:
          'Lenovo LOQ с Ryzen 5, SSD 512 ГБ и RTX 5050 8 ГБ.\n- Отличный выбор\nhttps://example.com',
      }).characteristics,
      [],
    );
  });

  it('preserves seller parameters if the model omits or contradicts them', () => {
    const result = parseAutofillResult(
      JSON.stringify({
        description: 'Ноутбук',
        characteristics: [
          { key: 'Накопитель', value: 'SSD 256 ГБ' },
          { key: 'Видеокарта', value: 'RTX 5050' },
        ],
      }),
      CATEGORIES,
      {
        characteristics: [{ key: 'Накопитель', value: 'SSD 512 ГБ' }],
        description: '- **Видеопамять:** 8 ГБ',
      },
    );
    assert.deepEqual(result.characteristics, [
      { key: 'Накопитель', value: 'SSD 512 ГБ' },
      { key: 'Видеопамять', value: '8 ГБ' },
      { key: 'Видеокарта', value: 'RTX 5050' },
    ]);
  });

  it('rejects a non-object response and does not count seller input as AI output', () => {
    assert.throws(() => parse([]), /не объект/);
    assert.throws(
      () =>
        parseAutofillResult('{}', CATEGORIES, {
          characteristics: [{ key: 'ОЗУ', value: '16 ГБ' }],
        }),
      /ни одного поля/,
    );
  });
});

describe('product autofill service characteristic contract', () => {
  it('returns structured parameters from one model call and settles once', async () => {
    const requests: unknown[] = [];
    let settled = 0;
    const service = new ProductAutofillService(
      {
        chat: {
          completions: {
            create: async (request: unknown) => {
              requests.push(request);
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        description: 'Ноутбук.\n- **Видеопамять:** 8 ГБ',
                        characteristics: { Процессор: 'Ryzen 5' },
                      }),
                    },
                  },
                ],
              };
            },
          },
        },
      } as never,
      { toDataUrl: async () => 'data:image/jpeg;base64,AA==' } as never,
      { getTree: async () => [], describeForCheck: async () => null } as never,
      {} as never,
      {
        holdAutofill: async () => ({ kind: 'platform' }),
        settleAutofill: async () => {
          settled++;
          return 0;
        },
      } as never,
      { record: async () => {} } as never,
      { get: () => 'test-model' } as never,
    );
    const result = await service.fill(
      {
        name: 'Lenovo LOQ',
        photoKeys: ['source'],
        characteristics: [{ key: 'Накопитель', value: 'SSD 512 ГБ' }],
      },
      { id: 1, isAdmin: true },
    );
    assert.deepEqual(result.characteristics, [
      { key: 'Накопитель', value: 'SSD 512 ГБ' },
      { key: 'Процессор', value: 'Ryzen 5' },
      { key: 'Видеопамять', value: '8 ГБ' },
    ]);
    assert.equal(requests.length, 1);
    assert.equal(settled, 1);
  });
});

describe('autofill outcome by the kind of hold', () => {
  it('bills the admin to the platform, not to a shop, and does not call it free', () => {
    assert.deepEqual(autofillOutcome({ kind: 'platform' }), {
      shopId: null,
      free: false,
      freeLeft: null,
    });
  });

  it('leaves no counter for an unlimited plan: PRO and MAX have nothing to run out of', () => {
    assert.deepEqual(autofillOutcome({ kind: 'unlimited', shopId: 7 }), {
      shopId: 7,
      free: true,
      freeLeft: null,
    });
  });

  it('reports how many free tries are left after this one', () => {
    assert.deepEqual(
      autofillOutcome({
        kind: 'free',
        shopId: 7,
        month: '2026-08-01',
        leftAfter: 3,
      }),
      { shopId: 7, free: true, freeLeft: 3 },
    );
  });

  it('keeps the shop of the reservation itself, not the one resolved by owner', () => {
    assert.deepEqual(
      autofillOutcome({ kind: 'paid', hold: { shopId: 7, credits: 10 } }),
      { shopId: 7, free: false, freeLeft: null },
    );
  });
});
