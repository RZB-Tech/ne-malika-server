import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { AiModule } from '../ai/ai.module';
import { CategoriesModule } from '../categories/categories.module';
import { SearchStatsModule } from '../search-stats/search-stats.module';
import { ProductCardsRepository } from './product-cards.repository';
import { ProductCardsService } from './product-cards.service';
import { ProductCardsController } from './product-cards.controller';
import { SellerProductCardsController } from './seller-product-cards.controller';
import { SellerAiChecksController } from './seller-ai-checks.controller';
import { AdminProductCardsController } from './admin-product-cards.controller';

/**
 * `SearchStatsModule` импортируется в одну сторону и колец не создаёт: счётчик
 * поисковых запросов зависит только от соединения с базой и ничего не знает про
 * каталог. Обратное направление (счётчик, сам ходящий за выдачей) замкнуло бы
 * зависимость и заодно означало бы второй такой же поиск ради статистики.
 */
@Module({
  imports: [ShopsModule, AiModule, CategoriesModule, SearchStatsModule],
  controllers: [
    ProductCardsController,
    SellerProductCardsController,
    SellerAiChecksController,
    AdminProductCardsController,
  ],
  providers: [ProductCardsRepository, ProductCardsService],
  exports: [ProductCardsService, ProductCardsRepository],
})
export class ProductCardsModule {}
