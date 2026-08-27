import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAnalyticsCsv,
  type AnalyticsCsvInput,
  type AnalyticsCsvProduct,
} from './shop-analytics.csv';

/**
 * Проверяется ровно то, что ломает файл у продавца: содержимое названия товара.
 * Названия пишет человек, и в них попадает и точка с запятой, и кавычка, и
 * перевод строки, вставленный из чужого прайса вместе с форматированием.
 */

const DAY = {
  date: '2026-08-18',
  views: 312,
  visitors: 204,
  phoneClicks: 18,
  telegramClicks: 26,
  contactVisitors: 33,
};

function product(name: string): AnalyticsCsvProduct {
  return {
    name,
    views: 512,
    visits: 340,
    contacts: 47,
    contactVisitors: 38,
    conversionPercent: 11,
  };
}

function csv(overrides: Partial<AnalyticsCsvInput> = {}): string {
  return buildAnalyticsCsv({
    shopName: 'Малика Электроникс',
    from: '2026-07-20',
    to: '2026-08-18',
    daily: [DAY],
    topProducts: [product('Ноутбук ASUS X515')],
    ...overrides,
  });
}

/** Метка кодировки в начале файла — разбор в докблоке `shop-analytics.csv.ts`. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Записи файла без метки кодировки: строки, разделённые CRLF. Перевод строки
 * внутри ячейки сюда попадать не должен — на этом и держится половина проверок.
 */
function records(text: string): string[] {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return body.split('\r\n');
}

describe('выгрузка аналитики в CSV', () => {
  it('начинается с BOM и разделяет столбцы точкой с запятой', () => {
    const text = csv();

    assert.ok(text.startsWith(BOM), 'файл начинается с метки кодировки');
    assert.ok(
      records(text).includes('"Магазин";"Малика Электроникс"'),
      'шапка собрана точкой с запятой',
    );
  });

  /**
   * Без кавычек Excel прочитал бы «Ноутбук» и «б/у» как два столбца, и вся
   * таблица правее уехала бы на одну ячейку — начиная с этой строки.
   */
  it('не разрывает ячейку на точке с запятой в названии', () => {
    const text = csv({ topProducts: [product('Ноутбук; б/у')] });
    const line = records(text).find((r) => r.startsWith('"Ноутбук'));

    assert.equal(line, '"Ноутбук; б/у";"512";"340";"47";"38";"11"');
  });

  /** Единственный способ записать кавычку внутри значения — удвоить её. */
  it('удваивает кавычку в названии', () => {
    const text = csv({ topProducts: [product('Ноутбук "Асус"')] });
    const line = records(text).find((r) => r.startsWith('"Ноутбук'));

    assert.equal(line, '"Ноутбук ""Асус""";"512";"340";"47";"38";"11"');
  });

  it('не добавляет строку в файл из-за переноса внутри названия', () => {
    const plain = csv({ topProducts: [product('Ноутбук ASUS')] });
    const wrapped = csv({ topProducts: [product('Ноутбук\nASUS')] });

    assert.equal(records(wrapped).length, records(plain).length);
    assert.ok(wrapped.includes('"Ноутбук\nASUS";"512"'));
  });

  /**
   * Windows-перенос внутри значения приводится к `\n`: иначе он записан теми же
   * байтами, что и конец строки файла, и построчный разборщик развалит таблицу.
   */
  it('приводит CRLF внутри названия к одиночному переводу строки', () => {
    const text = csv({ topProducts: [product('Ноутбук\r\nASUS')] });

    assert.ok(text.includes('"Ноутбук\nASUS";"512"'));
    assert.equal(records(text).length, records(csv()).length);
  });

  /**
   * Пустая выборка — обычное дело: магазин завели вчера, а период просят за
   * месяц. Файл обязан открыться и объяснить, что в нём ничего нет, а не
   * оказаться нулевым по длине.
   */
  it('на пустой выборке отдаёт шапку и заголовки без строк данных', () => {
    const text = csv({ daily: [], topProducts: [] });
    const lines = records(text);

    assert.ok(text.startsWith(BOM), 'файл начинается с метки кодировки');
    assert.deepEqual(lines, [
      '"Магазин";"Малика Электроникс"',
      '"Период";"2026-07-20 — 2026-08-18"',
      '',
      '"По дням"',
      '"Дата";"Просмотры";"Посетители";"Раскрытий телефона";"Переходов в Telegram";"Дошли до контакта"',
      '',
      '"Топ товаров"',
      '"Товар";"Просмотры";"Посещения";"Контакты";"Дошли до контакта";"Конверсия, %"',
      '',
    ]);
  });

  it('выводит сутки числами в порядке столбцов', () => {
    const line = records(csv()).find((r) => r.startsWith('"2026-08-18"'));

    assert.equal(line, '"2026-08-18";"312";"204";"18";"26";"33"');
  });
});
