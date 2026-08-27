import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../../db/schema';
import {
  ProductCardsRepository,
  PROMO_BUCKET_SEC,
  promoBucket,
} from './product-cards.repository';
import { PLAN_LIMITS } from '../subscriptions/subscriptions.constants';
import type { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';

/**
 * Продвижение живёт целиком в `ORDER BY`, а `EXPLAIN` по нему прогнать негде:
 * базы в наборе тестов нет и не будет. Поэтому проверяется то, что проверить
 * можно без неё, — сам текст запроса.
 *
 * Драйвер подменён заглушкой: drizzle обращается к `pool.query(config, params)`
 * и больше ни к чему, так что запрос собирается целиком, а вместо отправки
 * попадает в массив. Ни соединения, ни контейнера, ни сети.
 *
 * Закрыты три вещи, каждая из которых стоит дорого при поломке:
 * 1. граница включения — фильтрованная или отсортированная выдача не должна
 *    подменяться оплаченной;
 * 2. отсутствие нового join — вес берётся из уже приджойненного `shops`;
 * 3. неприкосновенность счётного запроса — продвижение меняет порядок, а не
 *    состав, и `total` с пагинацией обязаны остаться прежними.
 */
function captureRepository() {
  const captured: { text: string; params: unknown[] }[] = [];

  const client = {
    query: (config: { text: string }, params: unknown[]) => {
      captured.push({ text: config.text, params });
      return Promise.resolve({ rows: [], rowCount: 0, fields: [] });
    },
  };

  const db = drizzle(client as unknown as Pool, { schema });
  return { repository: new ProductCardsRepository(db), captured };
}

/** Запрос выдачи — тот из пары, что не считает строки. */
async function listSql(
  query: FindProductCardsQueryDto,
  categoryIds?: number[],
): Promise<{ text: string; params: unknown[] }> {
  const { repository, captured } = captureRepository();
  await repository.findPublicList(query, categoryIds);

  const list = captured.find((q) => !q.text.includes('count(*)'));
  assert.ok(list, 'запрос выдачи не собрался');
  return list;
}

const RANDOM: FindProductCardsQueryDto = { sort: 'random', seed: 'k3f9d1a7' };

describe('корзина времени для продвижения', () => {
  it('округляет вниз до пятиминутки', () => {
    const at = promoBucket(new Date('2026-08-27T10:07:41.512Z'));
    assert.equal(at.toISOString(), '2026-08-27T10:05:00.000Z');
  });

  it('не меняется внутри одной корзины — порядок страниц одной ленты совпадёт', () => {
    const first = promoBucket(new Date('2026-08-27T10:05:00.000Z'));
    const last = promoBucket(new Date('2026-08-27T10:09:59.999Z'));

    assert.equal(first.getTime(), last.getTime());
    assert.equal(
      promoBucket(new Date('2026-08-27T10:10:00.000Z')).getTime() -
        first.getTime(),
      PROMO_BUCKET_SEC * 1000,
    );
  });
});

describe('граница включения продвижения', () => {
  it('нетронутая витрина вперемешку — вес подписки в порядке выдачи', async () => {
    const { text, params } = await listSql(RANDOM);

    assert.match(text, /power\(/);
    assert.match(text, /"shops"\."subscription_until" >/);
    assert.match(text, /"shops"\."subscription_plan" =/);

    /** Веса и планы приходят параметрами — сверяем с таблицей тарифов, а не с числами в тексте. */
    assert.ok(params.includes(PLAN_LIMITS.max.promoWeight));
    assert.ok(params.includes(PLAN_LIMITS.pro.promoWeight));
    assert.ok(params.includes('max'));
    assert.ok(params.includes('pro'));
  });

  it('вес START в запрос не попадает — он равен единице, то есть ничему', async () => {
    const { text } = await listSql(RANDOM);

    assert.equal(PLAN_LIMITS.start.promoWeight, 1);
    assert.doesNotMatch(text, /'start'/);
  });

  for (const [label, query, categoryIds] of [
    ['поиск', { ...RANDOM, q: 'ноутбук' }, undefined],
    ['ветка каталога', RANDOM, [12, 13]],
    ['несуществующая категория', RANDOM, []],
    ['конкретный магазин', { ...RANDOM, shop_id: 7 }, undefined],
    ['нижняя граница цены', { ...RANDOM, price_min: 100 }, undefined],
    ['верхняя граница цены', { ...RANDOM, price_max: 100 }, undefined],
    ['состояние товара', { ...RANDOM, state: 'new' as const }, undefined],
    ['список id', { ...RANDOM, ids: [1, 2] }, undefined],
    ['пустой список id', { ...RANDOM, ids: [] }, undefined],
  ] as [string, FindProductCardsQueryDto, number[] | undefined][]) {
    it(`${label} — выдачу не подменяем: продвижения нет`, async () => {
      const { text } = await listSql(query, categoryIds);

      assert.doesNotMatch(text, /power\(/);
      assert.match(text, /md5\(/);
    });
  }

  for (const sort of ['newest', 'price_asc', 'price_desc'] as const) {
    it(`сортировка ${sort} продвижения не знает`, async () => {
      const { text } = await listSql({ sort });
      assert.doesNotMatch(text, /power\(/);
    });
  }
});

describe('форма запроса с продвижением', () => {
  it('нового соединения не появилось — вес берётся из уже приджойненного shops', async () => {
    const promoted = await listSql(RANDOM);
    const plain = await listSql({ ...RANDOM, shop_id: 7 });

    const joins = (text: string) => text.match(/(inner|left) join "\w+"/g);
    assert.deepEqual(joins(promoted.text), joins(plain.text));
  });

  it('счётный запрос продвижение не трогает', async () => {
    const { repository, captured } = captureRepository();
    await repository.findPublicList(RANDOM);

    const count = captured.find((q) => q.text.includes('count(*)'));
    assert.ok(count);
    assert.doesNotMatch(count.text, /power\(/);
    assert.doesNotMatch(count.text, /order by/);
  });
});

describe('магазины выдачи для счётчика поисковых запросов', () => {
  it('берёт различные магазины по всей выдаче, а не по странице', async () => {
    const { repository, captured } = captureRepository();
    await repository.findMatchingShopIds(
      { q: 'ноутбук', page: 1 },
      undefined,
      200,
    );

    assert.equal(captured.length, 1);
    assert.match(captured[0].text, /select distinct/);
    assert.match(captured[0].text, /"product_cards"\."shop_id"/);
    assert.ok(captured[0].params.includes(200));

    /** Тот же join, что у выдачи: `shops` нужен и статусу магазина, и поиску по его названию. */
    assert.match(captured[0].text, /inner join "shops"/);
    /** А `categories` не нужен: к нему обращается только проекция, которой здесь нет. */
    assert.doesNotMatch(captured[0].text, /join "categories"/);
  });
});
