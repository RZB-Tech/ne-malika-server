import { Module } from '@nestjs/common';
import { ProductViewsRepository } from './product-views.repository';
import { ProductViewsService } from './product-views.service';
import { ProductViewsController } from './product-views.controller';

@Module({
  controllers: [ProductViewsController],
  providers: [ProductViewsRepository, ProductViewsService],
})
export class ProductViewsModule {}
