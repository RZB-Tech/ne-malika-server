import { Module } from '@nestjs/common';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { ShopsModule } from '../shops/shops.module';
import { SearchStatsModule } from '../search-stats/search-stats.module';
import { ProductStatsRepository } from './product-stats.repository';
import { ProductStatsService } from './product-stats.service';
import { ProductStatsController } from './product-stats.controller';
import { SellerProductStatsController } from './seller-product-stats.controller';
import { SellerShopAnalyticsController } from './seller-shop-analytics.controller';
import { AdminStatsController } from './admin-stats.controller';

/**
 * RedisModule не импортируется: он объявлен @Global. ProductCardsModule нужен
 * ради `getOwnOrThrow` — проверки, что продавец смотрит статистику своего
 * товара. ShopsModule — ради `getActiveOwnShopOrThrow`: аналитика магазина
 * выводит магазин по владельцу и там же читает его действующий тариф.
 * SearchStatsModule — ради отчёта по поисковым запросам: таблицу запросов
 * ведёт он, а показывает её продавцу ручка аналитики.
 *
 * Кольца отсюда не выходит: ProductCardsModule сам импортирует ShopsModule и
 * SearchStatsModule, а обратно на статистику товаров не смотрит никто, кроме
 * корневого модуля.
 */
@Module({
  imports: [ProductCardsModule, ShopsModule, SearchStatsModule],
  controllers: [
    ProductStatsController,
    SellerProductStatsController,
    SellerShopAnalyticsController,
    AdminStatsController,
  ],
  providers: [ProductStatsRepository, ProductStatsService],
  exports: [ProductStatsService],
})
export class ProductStatsModule {}
