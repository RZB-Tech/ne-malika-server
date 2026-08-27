import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAutofillResult } from './product-autofill.types';
import { autofillOutcome } from './product-autofill.service';
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
    assert.equal(parse({ description: 'Мышь', categoryId: 99 }).categoryId, null);
  });

  it('treats an unclear condition as unknown rather than guessing', () => {
    assert.equal(parse({ description: 'Мышь', state: 'new' }).state, 'new');
    assert.equal(parse({ description: 'Мышь', state: 'возможно новый' }).state, null);
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
    assert.equal(parse({ description: 'Кабель', brand: ' Anker ' }).brand, 'Anker');
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
});

/**
 * Три поля ответа — `shopId` для журнала, `free` и `freeLeft` для формы —
 * выводятся из одного резерва, и разъехаться им проще всего именно здесь:
 * каждое читается в своём месте кода, и посчитать `free` в журнале иначе, чем в
 * ответе продавцу, ничего не мешает. Проверка держит все четыре ветки разом.
 */
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
