import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../../db/schema';
import { ShopsRepository } from './shops.repository';
import type { FindPublicShopsQueryDto } from './dto/find-public-shops-query.dto';

function captureRepository() {
  const captured: { text: string; params: unknown[] }[] = [];

  const client = {
    query: (config: { text: string }, params: unknown[]) => {
      captured.push({ text: config.text, params });
      return Promise.resolve({ rows: [], rowCount: 0, fields: [] });
    },
  };

  const db = drizzle(client as unknown as Pool, { schema });
  return { repository: new ShopsRepository(db), captured };
}

async function listSql(
  query: FindPublicShopsQueryDto = {},
): Promise<{ text: string; params: unknown[] }> {
  const { repository, captured } = captureRepository();
  await repository.findPublicList(query);

  const list = captured.find((q) => !q.text.startsWith('select count(*)'));
  assert.ok(list, 'запрос выдачи не собрался');
  return list;
}

describe('каталог магазинов: что попадает в выдачу', () => {
  it('только активные магазины', async () => {
    const { text, params } = await listSql();

    assert.match(text, /"shops"\."status" =/);
    assert.ok(params.includes('active'));
  });

  it('магазин без активных товаров в каталог не попадает', async () => {
    const { text } = await listSql();

    assert.match(text, /exists \(/);
    assert.match(text, /"product_cards"\."shop_id" = "shops"\."id"/);
    assert.match(text, /"product_cards"\."status" =/);
  });

  it('в выдаче считаются только активные товары', async () => {
    const { text } = await listSql();

    assert.match(text, /select count\(\*\)::int from "product_cards"/);
  });

  it('телефон магазина в списке не отдаём — он раскрывается в карточке', async () => {
    const { text } = await listSql();

    assert.doesNotMatch(text, /"shops"\."contact"/);
  });

  it('баланс кредитов и тариф в каталог не просачиваются', async () => {
    const { text } = await listSql();

    assert.doesNotMatch(text, /credits_balance/);
    assert.doesNotMatch(text, /subscription_plan/);
    assert.doesNotMatch(text, /subscription_credits/);
  });
});

describe('поиск по каталогу магазинов', () => {
  it('ищет по названию и адресу', async () => {
    const { text, params } = await listSql({ q: 'техно' });

    assert.match(text, /"shops"\."name" ilike/);
    assert.match(text, /"shops"\."address" ilike/);
    assert.ok(params.includes('%техно%'));
  });

  it('спецсимволы LIKE экранируются — «100%» ищет строку, а не всё подряд', async () => {
    const { params } = await listSql({ q: '100%' });

    assert.ok(params.includes('%100\\%%'));
  });

  it('пустой запрос фильтр не добавляет', async () => {
    const { text } = await listSql({ q: '   ' });

    assert.doesNotMatch(text, /ilike/);
  });
});

describe('порядок в каталоге магазинов', () => {
  const orderBy = (text: string) =>
    text.slice(text.lastIndexOf('order by')).split(' limit')[0];

  it('по умолчанию — сначала магазины с большим ассортиментом', async () => {
    const { text } = await listSql();
    const order = orderBy(text);

    assert.match(order, /count\(\*\)::int from "product_cards"[\s\S]*desc/);
    assert.match(order, /"shops"\."rating_avg" desc/);
  });

  it('по рейтингу — магазины без отзывов уходят в конец', async () => {
    const { text } = await listSql({ sort: 'rating' });
    const order = orderBy(text);

    assert.match(order, /"shops"\."rating_count" = 0/);
    assert.match(order, /"shops"\."rating_avg" desc/);
    assert.ok(
      order.indexOf('rating_count" = 0') < order.indexOf('rating_avg" desc'),
      'признак «без отзывов» должен стоять первым столбцом сортировки',
    );
  });

  it('по новизне — свежие магазины сверху', async () => {
    const order = orderBy((await listSql({ sort: 'newest' })).text);

    assert.match(order, /"shops"\."created_at" desc/);
  });

  it('по названию — по алфавиту', async () => {
    const order = orderBy((await listSql({ sort: 'name' })).text);

    assert.match(order, /"shops"\."name" asc/);
  });

  for (const sort of ['products', 'rating', 'newest', 'name'] as const) {
    it(`${sort}: последний столбец — id, иначе страницы задвоят магазины`, async () => {
      const order = orderBy((await listSql({ sort })).text);

      assert.match(order, /"shops"\."id" asc$/);
    });
  }
});

describe('счётный запрос каталога', () => {
  it('повторяет фильтры выдачи, но без сортировки и постраничности', async () => {
    const { repository, captured } = captureRepository();
    await repository.findPublicList({ q: 'техно' });

    const count = captured.find((q) => q.text.startsWith('select count(*)'));
    assert.ok(count, 'счётный запрос не собрался');

    assert.match(count.text, /exists \(/);
    assert.match(count.text, /ilike/);
    assert.doesNotMatch(count.text, /order by/);
    assert.doesNotMatch(count.text, /limit/);
  });
});

describe('магазины для sitemap', () => {
  it('отдаёт только активные магазины с товарами, свежие сверху', async () => {
    const { repository, captured } = captureRepository();
    await repository.findPublicIds();

    assert.equal(captured.length, 1);
    const { text } = captured[0];

    assert.match(text, /"shops"\."status" =/);
    assert.match(text, /exists \(/);
    assert.match(text, /order by "shops"\."updated_at" desc/);
    assert.doesNotMatch(text, /limit/);
  });
});

describe('карточка магазина', () => {
  it('деньги магазина на публичном эндпоинте не запрашиваются', async () => {
    const { repository, captured } = captureRepository();
    await repository.findPublicById(1);

    const text = captured.map((q) => q.text).join('\n');

    assert.doesNotMatch(text, /credits_balance/);
    assert.doesNotMatch(text, /credits_reserved/);
    assert.doesNotMatch(text, /subscription_plan/);
    assert.doesNotMatch(text, /subscription_credits/);
    assert.doesNotMatch(text, /autofill_free_used/);
  });

  it('поля, на которых держится витрина, остаются', async () => {
    const { repository, captured } = captureRepository();
    await repository.findPublicById(1);

    const text = captured.map((q) => q.text).join('\n');

    for (const column of [
      'name',
      'description',
      'photo',
      'telegram_link',
      'contact',
      'address',
      'work_schedule',
      'location',
      'rating_avg',
      'rating_count',
    ]) {
      assert.match(text, new RegExp(column), `потерялась колонка ${column}`);
    }
  });
});
