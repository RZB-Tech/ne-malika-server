import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../../db/schema';
import type { NewBanner } from '../../db/schema';
import type { ShopsService } from '../shops/shops.service';
import type { FilesService } from '../files/files.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { RedisService } from '../redis/redis.service';
import { BannersRepository } from './banners.repository';
import { BannersService } from './banners.service';
import type { CreateBannerDto } from './dto/create-banner.dto';

function captureRepository() {
  const captured: { text: string; params: unknown[] }[] = [];
  const client = {
    query: (config: { text: string }, params: unknown[]) => {
      captured.push({ text: config.text, params });
      return Promise.resolve({ rows: [], rowCount: 0, fields: [] });
    },
  };
  return {
    repository: new BannersRepository(
      drizzle(client as unknown as Pool, { schema }),
    ),
    captured,
  };
}

describe('срок показа в публичной выдаче баннеров', () => {
  it('магазинный баннер зависит от MAX, а не от своей старой даты', async () => {
    const { repository, captured } = captureRepository();
    await repository.findActiveShop('rotation', 4);
    const { text, params } = captured[0];

    assert.doesNotMatch(text, /expires_at/);
    assert.match(text, /"shops"\."subscription_plan" =/);
    assert.ok(params.includes('max'));
    assert.match(text, /"shops"\."subscription_until" > now\(\)/);
    assert.match(text, /"shops"\."status" =/);
    assert.ok(params.includes('active'));
    assert.match(text, /"banners"\."is_active" =/);
    assert.match(text, /"banners"\."status" =/);
    assert.ok(params.includes('approved'));
  });

  it('площадочный баннер по-прежнему скрывается после своей даты', async () => {
    const { repository, captured } = captureRepository();
    await repository.findActivePlatform();
    const { text } = captured[0];

    assert.match(text, /"banners"\."shop_id" is null/);
    assert.match(text, /"banners"\."expires_at" is null/);
    assert.match(text, /"banners"\."expires_at" > now\(\)/);
  });
});

const past = '2020-01-01T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';
const dto: CreateBannerDto = {
  title: 'Магазин MAX',
  photoRu: '8ac1b7f5-fdfa-42d0-8cd0-3f084b5844dc',
  photoUzLatn: 'ed1880df-90ef-4b02-a8c4-4e6aa42398d5',
  expiresAt: past,
};

function serviceFor(shopId: number | null) {
  const writes: Partial<NewBanner>[] = [];
  const notifications: string[] = [];
  const invalidated: string[] = [];
  const repository = {
    findById: () =>
      Promise.resolve({ id: 1, shopId, expiresAt: new Date(past) }),
    countOwned: () => Promise.resolve(0),
    maxSortOrder: () => Promise.resolve(0),
    create: (data: NewBanner) => {
      writes.push(data);
      return Promise.resolve({ ...data, id: 1 });
    },
    update: (_id: number, data: Partial<NewBanner>) => {
      writes.push(data);
      return Promise.resolve({ ...data, id: 1 });
    },
  };
  const service = new BannersService(
    repository as unknown as BannersRepository,
    {
      getOrThrow: (id: number) =>
        Promise.resolve({
          id,
          owner: 42,
          subscriptionPlan: 'max',
          subscriptionUntil: new Date(future),
        }),
    } as unknown as ShopsService,
    { exists: () => Promise.resolve(true) } as unknown as FilesService,
    {
      notifyUser: (_owner: number, text: string) => {
        notifications.push(text);
        return Promise.resolve();
      },
      pushToUser: (_owner: number, message: { body: string }) => {
        notifications.push(message.body);
        return Promise.resolve();
      },
    } as unknown as NotificationsService,
    {
      del: (key: string) => {
        invalidated.push(key);
        return Promise.resolve();
      },
    } as unknown as RedisService,
  );
  return { service, writes, notifications, invalidated };
}

describe('администратор выдаёт и правит баннеры', () => {
  it('при выдаче магазину не сохраняет отдельный срок', async () => {
    const { service, writes, notifications, invalidated } = serviceFor(null);
    await service.create({ ...dto, shopId: 7 }, 42);

    assert.equal(writes[0].expiresAt, null);
    assert.equal(writes[0].status, 'approved');
    assert.equal(writes[0].isActive, true);
    assert.deepEqual(invalidated, ['banners:active']);
    assert.equal(notifications.length, 2);
    notifications.forEach((text) => assert.match(text, /подписка MAX/));
  });

  it('при создании баннера площадки сохраняет дату', async () => {
    const { service, writes } = serviceFor(null);
    await service.create(dto, 42);
    assert.equal(writes[0].expiresAt?.toISOString(), past);
  });

  for (const expiresAt of [past, future, null]) {
    it(`правка баннера магазина игнорирует expiresAt=${expiresAt}`, async () => {
      const { service, writes } = serviceFor(7);
      await service.update(1, { expiresAt });
      assert.equal(writes[0].expiresAt, null);
    });
  }

  it('правка текста очищает прежнюю дату баннера магазина', async () => {
    const { service, writes } = serviceFor(7);
    await service.update(1, { title: 'Новое название' });
    assert.equal(writes[0].expiresAt, null);
  });

  it('передача баннера площадки магазину очищает дату', async () => {
    const { service, writes } = serviceFor(null);
    await service.update(1, { shopId: 7 });
    assert.equal(writes[0].shopId, 7);
    assert.equal(writes[0].expiresAt, null);
  });

  it('при возврате баннера площадке можно задать срок', async () => {
    const { service, writes } = serviceFor(7);
    await service.update(1, { shopId: null, expiresAt: future });
    assert.equal(writes[0].shopId, null);
    assert.equal(writes[0].expiresAt?.toISOString(), future);
  });

  it('правка площадочного баннера без даты её не изменяет', async () => {
    const { service, writes } = serviceFor(null);
    await service.update(1, { title: 'Новое название' });
    assert.equal('expiresAt' in writes[0], false);
  });

  it('ручное отключение баннера сохраняется', async () => {
    const { service, writes } = serviceFor(7);
    await service.update(1, { isActive: false });
    assert.equal(writes[0].isActive, false);
  });
});
