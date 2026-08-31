import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ShopsRepository } from '../shops/shops.repository';
import type { ProductCardsRepository } from '../product-cards/product-cards.repository';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';
import type { CreateReportDto } from './dto/create-report.dto';

const SHOP = { id: 1, owner: 42, name: 'Тестовый' };
const CARD = { id: 10, shopId: 1 };

function uniqueViolation() {
  return Object.assign(new Error('duplicate key'), { code: '23505' });
}

function build(
  options: {
    insert?: () => Promise<unknown>;
    card?: { id: number; shopId: number };
  } = {},
) {
  const card = options.card ?? CARD;
  const notified: string[] = [];
  const inserted: unknown[] = [];

  const reports = {
    create: (data: unknown) => {
      inserted.push(data);
      return options.insert ? options.insert() : Promise.resolve({ id: 7 });
    },
  };

  const service = new ReportsService(
    reports as unknown as ReportsRepository,
    { findById: (id: number) => Promise.resolve(id === SHOP.id ? SHOP : undefined) } as unknown as ShopsRepository,
    {
      findById: (id: number) => Promise.resolve(id === card.id ? card : undefined),
    } as unknown as ProductCardsRepository,
    {
      notifyAdmins: (text: string) => {
        notified.push(text);
        return Promise.resolve();
      },
    } as unknown as NotificationsService,
  );

  return { service, notified, inserted };
}

const dto = (over: Partial<CreateReportDto> = {}): CreateReportDto =>
  ({ context: 'товар не тот', shop_id: SHOP.id, ...over }) as CreateReportDto;

describe('приём жалобы', () => {
  it('проставляет автора и зовёт админов', async () => {
    const { service, notified, inserted } = build();

    await service.create(7, dto());

    assert.deepEqual(inserted, [
      {
        context: 'товар не тот',
        authorId: 7,
        shopId: SHOP.id,
        productCardId: undefined,
      },
    ]);
    assert.equal(notified.length, 1, 'жалоба доходит до админов');
  });

  it('не даёт пожаловаться на свой магазин', async () => {
    const { service, inserted } = build();

    await assert.rejects(
      () => service.create(SHOP.owner, dto()),
      ForbiddenException,
    );
    assert.deepEqual(inserted, [], 'до вставки дело не доходит');
  });

  it('вторую жалобу на ту же цель отбивает как 409', async () => {
    const { service, notified } = build({
      insert: () => Promise.reject(uniqueViolation()),
    });

    await assert.rejects(() => service.create(7, dto()), ConflictException);
    assert.deepEqual(notified, [], 'дубль админов не будит');
  });

  it('не принимает несуществующие цель и товар', async () => {
    const { service } = build();

    await assert.rejects(
      () => service.create(7, dto({ shop_id: 999 })),
      NotFoundException,
      'магазина нет',
    );

    await assert.rejects(
      () => service.create(7, dto({ product_card_id: CARD.id + 1 })),
      NotFoundException,
      'товара нет',
    );
  });

  it('ловит товар, не принадлежащий указанному магазину', async () => {
    const { service } = build({ card: { id: CARD.id, shopId: 777 } });

    await assert.rejects(
      () => service.create(7, dto({ product_card_id: CARD.id })),
      BadRequestException,
    );
  });
});
