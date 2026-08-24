import { Module } from '@nestjs/common';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { OpenrouterModule } from '../openrouter/openrouter.module';
import { AiCompareService } from './ai-compare.service';
import { AiCompareController } from './ai-compare.controller';

@Module({
  imports: [OpenrouterModule, ProductCardsModule],
  controllers: [AiCompareController],
  providers: [AiCompareService],
})
export class AiCompareModule {}
