import { forwardRef, Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { ShopsModule } from '../shops/shops.module';
import { AiProductChecksRepository } from './ai-product-checks.repository';
import { AiService } from './ai.service';
import { SellerAiChecksController } from './seller-ai-checks.controller';

@Module({
  imports: [FilesModule, forwardRef(() => ProductCardsModule), ShopsModule],
  controllers: [SellerAiChecksController],
  providers: [AiProductChecksRepository, AiService],
  exports: [AiService],
})
export class AiModule {}
