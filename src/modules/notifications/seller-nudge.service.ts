import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/** Сколько дней без нового товара считаем «магазин заглох». */
const STALE_DAYS = 7;

/**
 * Как часто одному продавцу можно напоминать. Заметно больше STALE_DAYS:
 * иначе тот, кто просто торгует медленно, получал бы напоминание каждую
 * неделю и отписался бы от бота вместе со всеми полезными уведомлениями.
 */
const NUDGE_COOLDOWN_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Тексты для магазина, в котором ещё нет ни одного товара. Разные, потому что
 * одинаковая фраза раз в две недели читается как автоответчик и перестаёт
 * работать.
 */
const EMPTY_SHOP_TEXTS = [
  'В вашем магазине <b>{shop}</b> пока нет ни одного товара 🙂\nДобавьте первый — покупатели найдут его в каталоге в тот же день.',
  'Магазин <b>{shop}</b> создан, но витрина пустая.\nПервый товар занимает пару минут, а показы начинаются сразу после проверки.',
  '<b>{shop}</b> ещё не показывается в поиске — там нечего показывать 😅\nДобавьте товар, и магазин появится в каталоге.',
];

/** Тексты для магазина, который просто давно не пополняли. */
const STALE_SHOP_TEXTS = [
  'Давно не виделись! В <b>{shop}</b> не появлялось новых товаров уже {days} дн.\nСвежие карточки поднимаются в каталоге выше — добавьте пару штук.',
  'Покупатели чаще заходят в магазины, которые обновляются.\nВ <b>{shop}</b> последний товар добавлен {days} дн. назад — самое время пополнить витрину.',
  'Напоминаем про <b>{shop}</b>: новых товаров нет {days} дн.\nДобавьте то, что есть в наличии, — это бесплатно и занимает пару минут.',
  'Чем больше товаров в <b>{shop}</b>, тем чаще магазин попадает в выдачу.\nПоследнее пополнение было {days} дн. назад — добавим ещё?',
];

const FOOTER = '\n\nОтключить напоминания: /stop';

/**
 * Напоминания продавцам добавлять товары.
 *
 * Отдельный сервис, а не метод в NotificationsService: у него своя политика
 * (частота, тексты, кого считать заглохшим), и она меняется независимо от
 * механики отправки.
 */
@Injectable()
export class SellerNudgeService {
  private readonly logger = new Logger(SellerNudgeService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Раз в сутки в 10:00 по Ташкенту. Время не случайное: рассылать напоминания
   * ночью — верный способ получить отписку вместо товара.
   */
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
        `Не удалось выбрать продавцов для напоминания: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (sellers.length === 0) {
      this.logger.log('Напоминать некому — все магазины пополняются');
      return;
    }

    // Одним вызовом, а не по одному продавцу: пауза между сообщениями живёт
    // внутри deliver и на пачке из одного адресата не срабатывает — цикл
    // снаружи слал бы всё подряд и упёрся в лимит Telegram.
    const textById = new Map(
      sellers.map((seller) => [seller.id, this.buildText(seller, now)]),
    );
    const result = await this.notifications.deliver(
      sellers.map((seller) => ({ id: seller.id, chatId: seller.chatId })),
      (recipient) => textById.get(recipient.id) ?? '',
    );

    // Отмечаем только доставленные: если бот заблокирован, отметка сдвинула бы
    // окно на две недели и человек не получил бы напоминание даже после того,
    // как разблокирует бота.
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

    if (seller.productCount === 0) {
      return (
        pick(EMPTY_SHOP_TEXTS, shop.length).replace('{shop}', shop) + FOOTER
      );
    }

    const days = seller.lastProductAt
      ? Math.max(
          1,
          Math.round((now - new Date(seller.lastProductAt).getTime()) / DAY_MS),
        )
      : STALE_DAYS;

    return (
      pick(STALE_SHOP_TEXTS, shop.length + days)
        .replace('{shop}', shop)
        .replaceAll('{days}', String(days)) + FOOTER
    );
  }
}

/**
 * Вариант текста по признаку самого продавца, а не случайный: один и тот же
 * магазин получает разные тексты по мере роста числа дней, но повтор запуска
 * задачи в тот же день не выдаёт другую формулировку.
 */
function pick(texts: readonly string[], seed: number): string {
  return texts[Math.abs(seed) % texts.length];
}

/** parse_mode: HTML — название магазина может содержать «<» или «&». */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
