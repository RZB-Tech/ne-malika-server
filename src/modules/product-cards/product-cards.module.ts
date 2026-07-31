import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { AiModule } from '../ai/ai.module';
import { ProductCardsRepository } from './product-cards.repository';
import { ProductCardsService } from './product-cards.service';
import { ProductCardsController } from './product-cards.controller';
import { SellerProductCardsController } from './seller-product-cards.controller';
import { SellerAiChecksController } from './seller-ai-checks.controller';
import { AdminProductCardsController } from './admin-product-cards.controller';

@Module({
  imports: [ShopsModule, AiModule],
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
