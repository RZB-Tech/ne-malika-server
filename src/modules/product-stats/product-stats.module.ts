import { Module } from '@nestjs/common';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { ProductStatsRepository } from './product-stats.repository';
import { ProductStatsService } from './product-stats.service';
import { ProductStatsController } from './product-stats.controller';
import { SellerProductStatsController } from './seller-product-stats.controller';
import { AdminStatsController } from './admin-stats.controller';

/**
 * RedisModule не импортируется: он объявлен @Global. ProductCardsModule нужен
 * ради `getOwnOrThrow` — проверки, что продавец смотрит статистику своего товара.
 */
@Module({
  imports: [ProductCardsModule],
  controllers: [
    ProductStatsController,
    SellerProductStatsController,
    AdminStatsController,
  ],
  providers: [ProductStatsRepository, ProductStatsService],
  exports: [ProductStatsService],
})
export class ProductStatsModule {}
