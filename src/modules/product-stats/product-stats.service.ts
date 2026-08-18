import { Injectable, NotFoundException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ProductCardsService } from '../product-cards/product-cards.service';
import {
  ProductStatsRepository,
  type StatsDelta,
} from './product-stats.repository';
import type { ProductEventKind } from './dto/record-product-event.dto';
import type { ProductStatsDto } from './dto/product-stats.dto';
import type {
  AdminActivityDto,
  ActivityPointDto,
} from './dto/admin-activity.dto';
import { eachDay, isBot, shiftDay, today } from './product-stats.util';

/**
 * Окно, в котором повторное действие того же посетителя по тому же товару не
 * считается. Защищает от F5 и от того, что карточка перемонтируется при
 * навигации назад-вперёд.
 */
const REPEAT_WINDOW_SEC = 30 * 60;

/** С запасом больше суток: ключ уникальности всё равно содержит дату. */
const DAY_KEY_TTL_SEC = 30 * 60 * 60;

@Injectable()
export class ProductStatsService {
  constructor(
    private readonly repository: ProductStatsRepository,
    private readonly redis: RedisService,
    private readonly productCardsService: ProductCardsService,
  ) {}

  /**
   * Записать событие с карточки товара.
   *
   * Тихо игнорирует ботов и повторы: у клиента нет способа и нет причины
   * реагировать на «не посчитали», а превращать это в ошибку значило бы
   * ронять аналитикой обычный просмотр страницы.
   */
  async record(
    productCardId: number,
    kind: ProductEventKind,
    visitorId: string,
    userAgent: string | undefined,
  ): Promise<void> {
    if (isBot(userAgent)) return;

    if (!(await this.repository.isPubliclyVisible(productCardId))) {
      throw new NotFoundException('Товар не найден');
    }

    const day = today();
    const delta = await this.buildDelta(productCardId, kind, visitorId, day);
    if (delta === null) return;

    await this.repository.record(productCardId, day, delta);
  }

  /**
   * Во что превращается событие. `null` — считать нечего: повтор в пределах окна.
   *
   * Счётчики «уникальных» берутся отдельными ключами с жизнью до конца суток,
   * а «сырые» — коротким окном: так один человек за день добавит единицу к
   * `visitors`, но несколько к `views`, если возвращался на карточку.
   */
  private async buildDelta(
    productCardId: number,
    kind: ProductEventKind,
    visitorId: string,
    day: string,
  ): Promise<StatsDelta | null> {
    const zero: StatsDelta = {
      views: 0,
      visitors: 0,
      phoneClicks: 0,
      telegramClicks: 0,
      contactVisitors: 0,
    };

    const base = `pstat:${visitorId}:${productCardId}`;

    if (kind === 'view') {
      const fresh = await this.redis.claim(`${base}:view`, REPEAT_WINDOW_SEC);
      if (!fresh) return null;

      const firstToday = await this.redis.claim(
        `${base}:visitor:${day}`,
        DAY_KEY_TTL_SEC,
      );

      return { ...zero, views: 1, visitors: firstToday ? 1 : 0 };
    }

    const fresh = await this.redis.claim(`${base}:${kind}`, REPEAT_WINDOW_SEC);
    if (!fresh) return null;

    const firstContactToday = await this.redis.claim(
      `${base}:contact:${day}`,
      DAY_KEY_TTL_SEC,
    );

    return {
      ...zero,
      phoneClicks: kind === 'phone' ? 1 : 0,
      telegramClicks: kind === 'telegram' ? 1 : 0,
      contactVisitors: firstContactToday ? 1 : 0,
    };
  }

  /** Статистика карточки для её владельца. */
  async forSeller(
    ownerId: number,
    productCardId: number,
    days: number,
  ): Promise<ProductStatsDto> {
    await this.productCardsService.getOwnOrThrow(ownerId, productCardId);

    const to = today();
    const from = shiftDay(to, -(days - 1));
    const rows = await this.repository.findRange(productCardId, from, to);

    const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
    const daily = eachDay(from, to).map((date) => {
      const row = byDay.get(date);
      return {
        date,
        views: row?.views ?? 0,
        visitors: row?.visitors ?? 0,
      };
    });

    const sevenFrom = shiftDay(to, -6);

    return {
      views: sum(rows, (r) => r.views),
      views7d: sum(
        rows.filter((r) => r.day.slice(0, 10) >= sevenFrom),
        (r) => r.views,
      ),
      visits: sum(rows, (r) => r.visitors),
      phoneClicks: sum(rows, (r) => r.phoneClicks),
      telegramClicks: sum(rows, (r) => r.telegramClicks),
      contactVisitors: sum(rows, (r) => r.contactVisitors),
      daily,
    };
  }

  /**
   * Активность площадки по дням: что заводили и как это смотрели.
   *
   * Четыре отдельных запроса вместо одного с полными внешними соединениями:
   * источники независимы, у каждого свои сутки с данными, и склейка в памяти
   * по короткому ряду (максимум 365 точек) дешевле и читается яснее.
   */
  async adminActivity(days: number): Promise<AdminActivityDto> {
    const to = today();
    const from = shiftDay(to, -(days - 1));

    const [products, shops, users, views] = await Promise.all([
      this.repository.productsByDay(from, to),
      this.repository.shopsByDay(from, to),
      this.repository.usersByDay(from, to),
      this.repository.viewsByDay(from, to),
    ]);

    const productsBy = toMap(products);
    const shopsBy = toMap(shops);
    const usersBy = toMap(users);
    const viewsBy = new Map(views.map((v) => [v.day.slice(0, 10), v] as const));

    const daily: ActivityPointDto[] = eachDay(from, to).map((date) => ({
      date,
      products: productsBy.get(date) ?? 0,
      shops: shopsBy.get(date) ?? 0,
      users: usersBy.get(date) ?? 0,
      views: viewsBy.get(date)?.views ?? 0,
      contacts: viewsBy.get(date)?.contacts ?? 0,
    }));

    return {
      daily,
      productsTotal: sum(daily, (d) => d.products),
      shopsTotal: sum(daily, (d) => d.shops),
      usersTotal: sum(daily, (d) => d.users),
      viewsTotal: sum(daily, (d) => d.views),
      contactsTotal: sum(daily, (d) => d.contacts),
    };
  }
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

function toMap(rows: { day: string; count: number }[]): Map<string, number> {
  return new Map(rows.map((r) => [r.day.slice(0, 10), r.count]));
}
