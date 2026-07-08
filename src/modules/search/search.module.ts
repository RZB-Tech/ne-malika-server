import { Module } from '@nestjs/common';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { AiModule } from '../ai/ai.module';
import { SemanticCacheService } from './semantic-cache.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  imports: [ProductCardsModule, AiModule],
  controllers: [SearchController],
  providers: [SemanticCacheService, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
