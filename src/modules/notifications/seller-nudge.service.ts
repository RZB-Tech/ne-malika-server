import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { escapeHtml } from '../bot/telegram-html';
import { errorMessage } from '../../common/errors';

const STALE_DAYS = 7;

const NUDGE_COOLDOWN_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_SHOP_TEXTS = [
  'В вашем магазине <b>{shop}</b> пока нет ни одного товара 🙂\nДобавьте первый — покупатели найдут его в каталоге в тот же день.',
  'Магазин <b>{shop}</b> создан, но витрина пустая.\nПервый товар занимает пару минут, а показы начинаются сразу после проверки.',
  '<b>{shop}</b> ещё не показывается в поиске — там нечего показывать 😅\nДобавьте товар, и магазин появится в каталоге.',
];

const STALE_SHOP_TEXTS = [
  'Давно не виделись! В <b>{shop}</b> не появлялось новых товаров уже {days} дн.\nСвежие карточки поднимаются в каталоге выше — добавьте пару штук.',
  'Покупатели чаще заходят в магазины, которые обновляются.\nВ <b>{shop}</b> последний товар добавлен {days} дн. назад — самое время пополнить витрину.',
  'Напоминаем про <b>{shop}</b>: новых товаров нет {days} дн.\nДобавьте то, что есть в наличии, — это бесплатно и занимает пару минут.',
  'Чем больше товаров в <b>{shop}</b>, тем чаще магазин попадает в выдачу.\nПоследнее пополнение было {days} дн. назад — добавим ещё?',
];

const FOOTER = '\n\nОтключить напоминания: /stop';

@Injectable()
export class SellerNudgeService {
  private readonly logger = new Logger(SellerNudgeService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Asia/Tashkent' })
  async run(): Promise<void> {
    const now = Date.now();
    const staleBefore = new Date(now - STALE_DAYS * DAY_MS);
    const nudgedBefore = new Date(now - NUDGE_COOLDOWN_DAYS * DAY_MS);

    let sellers: Awaited<ReturnType<NotificationsRepository['staleSellers']>> =
      [];
    try {
      sellers = await this.repository.staleSellers(staleBefore, nudgedBefore);
    } catch (err) {
      this.logger.error(
        `Не удалось выбрать продавцов для напоминания: ${errorMessage(err)}`,
      );
      return;
    }

    if (sellers.length === 0) {
      this.logger.log('Напоминать некому — все магазины пополняются');
      return;
    }

    const textById = new Map(
      sellers.map((seller) => [seller.id, this.buildText(seller, now)]),
    );
    const result = await this.notifications.deliver(
      sellers.map((seller) => ({ id: seller.id, chatId: seller.chatId })),
      (recipient) => textById.get(recipient.id) ?? '',
    );

    await this.repository.markNudged(result.deliveredIds);
    this.logger.log(
      `Напоминания продавцам: доставлено ${result.delivered} из ${sellers.length}`,
    );
  }

  private buildText(
    seller: {
      shopName: string;
      productCount: number;
      lastProductAt: Date | null;
    },
    now: number,
  ): string {
    const shop = escapeHtml(seller.shopName);

    const window = Math.floor(now / (NUDGE_COOLDOWN_DAYS * DAY_MS));

    if (seller.productCount === 0) {
      return (
        insertShop(pick(EMPTY_SHOP_TEXTS, shop.length + window), shop) + FOOTER
      );
    }

    const days = seller.lastProductAt
      ? Math.max(
          1,
          Math.round((now - new Date(seller.lastProductAt).getTime()) / DAY_MS),
        )
      : STALE_DAYS;

    return (
      insertShop(
        pick(STALE_SHOP_TEXTS, shop.length + days + window),
        shop,
      ).replaceAll('{days}', String(days)) + FOOTER
    );
  }
}

function pick(texts: readonly string[], seed: number): string {
  return texts[Math.abs(seed) % texts.length];
}

function insertShop(template: string, shop: string): string {
  return template.replace('{shop}', () => shop);
}
