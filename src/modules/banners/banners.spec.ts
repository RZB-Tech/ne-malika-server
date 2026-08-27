import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShopsService } from '../shops/shops.service';
import type { FilesService } from '../files/files.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { BannersService } from './banners.service';
import type { BannersRepository } from './banners.repository';
import {
  bucketKey,
  MAX_ACTIVE_BANNERS,
  SHOP_BANNER_ROTATION_SEC,
  SHOP_BANNER_SLOTS,
} from './banners.constants';

/**
 * Проверяется делёжка мест в карусели — единственное место, где обещание
 * «оплаченный баннер гарантированно виден» либо выполняется, либо нет.
 *
 * Через сервис с подставным репозиторием, а не через базу: обе выборки — это
 * `WHERE` и `ORDER BY`, читаемые глазами, а склейка — правило продукта, и
 * ломается оно при правке кода, а не данных. Поднимать Postgres в наборе,
 * который запускается `tsx --test` без единого контейнера, ради этого нечем и
 * незачем.
 *
 * Остальные три зависимости сервису в этой ветке не нужны вовсе: `findActive`
 * не спрашивает ни магазин, ни файлы, ни уведомления. Подставлять их заглушки
 * с методами значило бы утверждать обратное.
 */

interface Row {
  id: number;
}

function carousel(platform: number[], shop: number[]) {
  const repository = {
    findActivePlatform: (limit: number): Promise<Row[]> =>
      Promise.resolve(platform.slice(0, limit).map((id) => ({ id }))),
    findActiveShop: (_bucket: string, limit: number): Promise<Row[]> =>
      Promise.resolve(shop.slice(0, limit).map((id) => ({ id }))),
  };

  const service = new BannersService(
    repository as unknown as BannersRepository,
    undefined as unknown as ShopsService,
    undefined as unknown as FilesService,
    undefined as unknown as NotificationsService,
  );

  return service.findActive().then((rows) => rows.map((row) => row.id));
}

/** Площадочных заведомо больше, чем помещается: 101, 102, … */
const PLATFORM = Array.from({ length: 12 }, (_, i) => 101 + i);
/** Продавцов заведомо больше, чем слотов: 201, 202, … */
const SHOP = Array.from({ length: 6 }, (_, i) => 201 + i);

describe('склейка карусели главной', () => {
  it('отдаёт первое место площадке, следующие — продавцам', async () => {
    const ids = await carousel(PLATFORM, SHOP);

    assert.equal(ids[0], 101, 'первый слот остаётся за площадкой');
    assert.deepEqual(
      ids.slice(1, 1 + SHOP_BANNER_SLOTS),
      [201, 202, 203, 204],
      'баннеры продавцов идут подряд со второго слота',
    );
    assert.deepEqual(
      ids.slice(1 + SHOP_BANNER_SLOTS),
      [102, 103, 104, 105, 106],
      'дальше — остаток площадочных в своём порядке',
    );
  });

  it('не отдаёт продавцам больше мест, чем зарезервировано', async () => {
    const ids = await carousel(PLATFORM, SHOP);
    const paid = ids.filter((id) => id >= 200);

    assert.equal(paid.length, SHOP_BANNER_SLOTS);
    assert.equal(ids.length, MAX_ACTIVE_BANNERS);
  });

  /**
   * Обрезка режет хвост площадочных, а не оплаченные баннеры: длинная карусель
   * площадки не должна вытеснять то, за что заплатили.
   */
  it('длинная карусель площадки не вытесняет оплаченные баннеры', async () => {
    const ids = await carousel(PLATFORM, SHOP);

    for (const id of [201, 202, 203, 204]) {
      assert.ok(ids.includes(id), `баннер ${id} обязан остаться в выдаче`);
    }
  });

  it('без площадочных продавцы встают с первого места', async () => {
    const ids = await carousel([], SHOP);

    assert.deepEqual(ids, [201, 202, 203, 204]);
  });

  it('без подписчиков карусель остаётся прежней', async () => {
    const ids = await carousel(PLATFORM, []);

    assert.equal(ids.length, MAX_ACTIVE_BANNERS);
    assert.deepEqual(ids, PLATFORM.slice(0, MAX_ACTIVE_BANNERS));
  });

  it('пустая карусель не превращается в дырки', async () => {
    assert.deepEqual(await carousel([], []), []);
  });
});

describe('окно ротации баннеров продавцов', () => {
  it('не меняется внутри окна', () => {
    const start = new Date('2026-08-27T10:00:00.000Z');
    const almost = new Date(
      start.getTime() + SHOP_BANNER_ROTATION_SEC * 1000 - 1,
    );

    assert.equal(bucketKey(start), bucketKey(almost));
  });

  it('меняется на границе окна', () => {
    const start = new Date('2026-08-27T10:00:00.000Z');
    const next = new Date(start.getTime() + SHOP_BANNER_ROTATION_SEC * 1000);

    assert.notEqual(bucketKey(start), bucketKey(next));
  });
});
