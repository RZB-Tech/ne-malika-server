import { forwardRef, Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { AiModule } from '../ai/ai.module';
import { ProductCardsRepository } from './product-cards.repository';
import { ProductCardsService } from './product-cards.service';
import { ProductCardsController } from './product-cards.controller';
import { SellerProductCardsController } from './seller-product-cards.controller';
import { AdminProductCardsController } from './admin-product-cards.controller';

@Module({
  imports: [ShopsModule, forwardRef(() => AiModule)],
  controllers: [
    ProductCardsController,
    SellerProductCardsController,
    AdminProductCardsController,
  ],
  providers: [ProductCardsRepository, ProductCardsService],
  exports: [ProductCardsService, ProductCardsRepository],
})
export class ProductCardsModule {}
