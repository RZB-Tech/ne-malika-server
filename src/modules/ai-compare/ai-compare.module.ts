import { Module } from '@nestjs/common';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { AiCompareService } from './ai-compare.service';
import { AiCompareController } from './ai-compare.controller';

@Module({
  imports: [ProductCardsModule],
  controllers: [AiCompareController],
  providers: [openrouterClientProvider, AiCompareService],
})
export class AiCompareModule {}
