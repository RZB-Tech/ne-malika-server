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

@Module({
  imports: [ProductCardsModule, ShopsModule, SearchStatsModule],
  controllers: [
    ProductStatsController,
    SellerProductStatsController,
    SellerShopAnalyticsController,
    AdminStatsController,
  ],
  providers: [ProductStatsRepository, ProductStatsService],
})
export class ProductStatsModule {}
