import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Shop } from '../../db/schema';
import { RedisService } from '../redis/redis.service';
import { ProductCardsService } from '../product-cards/product-cards.service';
import { ShopsService } from '../shops/shops.service';
import { SearchStatsService } from '../search-stats/search-stats.service';
import { effectiveLimits } from '../subscriptions/subscriptions.constants';
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
import type { SearchHitDto } from '../search-stats/dto/search-hit.dto';
import type { ShopAnalyticsDto } from './dto/shop-analytics.dto';
import { buildAnalyticsCsv } from './shop-analytics.csv';
import { eachDay, isBot, shiftDay, today } from './product-stats.util';

const REPEAT_WINDOW_SEC = 30 * 60;

const DAY_KEY_TTL_SEC = 30 * 60 * 60;

const TOP_PRODUCTS = 10;

@Injectable()
export class ProductStatsService {
  constructor(
    private readonly repository: ProductStatsRepository,
    private readonly redis: RedisService,
    private readonly productCardsService: ProductCardsService,
    private readonly shopsService: ShopsService,
    private readonly searchStatsService: SearchStatsService,
  ) {}

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

  async forShop(ownerId: number, days: number): Promise<ShopAnalyticsDto> {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);
    return this.buildShopAnalytics(shop, days);
  }

  async searchesForShop(
    ownerId: number,
    days: number,
    limit: number,
  ): Promise<SearchHitDto[]> {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);
    requireMaxPlan(
      shop,
      'Статистика поисковых запросов доступна на тарифе MAX',
    );

    const to = today();
    const from = shiftDay(to, -(days - 1));

    return this.searchStatsService.topForShop(shop.id, from, to, limit);
  }

  async exportCsvForShop(ownerId: number, days: number): Promise<string> {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);
    requireMaxPlan(shop, 'Выгрузка CSV доступна на тарифе MAX');

    return buildAnalyticsCsv(await this.buildShopAnalytics(shop, days));
  }

  private async buildShopAnalytics(
    shop: Shop,
    days: number,
  ): Promise<ShopAnalyticsDto> {
    const allowed = effectiveLimits(shop).analyticsDays;
    if (days > allowed) {
      throw new ForbiddenException(
        'Период больше 30 дней доступен на тарифе MAX',
      );
    }

    const to = today();
    const from = shiftDay(to, -(days - 1));

    const [rows, top] = await Promise.all([
      this.repository.shopDaily(shop.id, from, to),
      this.repository.shopTopProducts(shop.id, from, to, TOP_PRODUCTS),
    ]);

    const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
    const daily = eachDay(from, to).map((date) => {
      const row = byDay.get(date);
      return {
        date,
        views: row?.views ?? 0,
        visitors: row?.visitors ?? 0,
        phoneClicks: row?.phoneClicks ?? 0,
        telegramClicks: row?.telegramClicks ?? 0,
        contactVisitors: row?.contactVisitors ?? 0,
      };
    });

    const visits = sum(rows, (r) => r.visitors);
    const contactVisitors = sum(rows, (r) => r.contactVisitors);
    const phoneClicks = sum(rows, (r) => r.phoneClicks);
    const telegramClicks = sum(rows, (r) => r.telegramClicks);

    return {
      shopId: shop.id,
      shopName: shop.name,
      from,
      to,
      views: sum(rows, (r) => r.views),
      visits,
      phoneClicks,
      telegramClicks,
      contacts: phoneClicks + telegramClicks,
      contactVisitors,
      conversionPercent: conversionOf(contactVisitors, visits),
      daily,
      topProducts: top.map((product) => ({
        id: product.id,
        name: product.name,
        views: product.views,
        visits: product.visitors,
        contacts: product.phoneClicks + product.telegramClicks,
        contactVisitors: product.contactVisitors,
        conversionPercent: conversionOf(
          product.contactVisitors,
          product.visitors,
        ),
      })),
    };
  }

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

function requireMaxPlan(shop: Shop, message: string): void {
  if (effectiveLimits(shop).id !== 'max') {
    throw new ForbiddenException(message);
  }
}

function conversionOf(contactVisitors: number, visits: number): number {
  if (visits === 0) return 0;
  return Math.round((contactVisitors / visits) * 100);
}

function toMap(rows: { day: string; count: number }[]): Map<string, number> {
  return new Map(rows.map((r) => [r.day.slice(0, 10), r.count]));
}
