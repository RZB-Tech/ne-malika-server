import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsAiService } from './reviews-ai.service';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { AdminReviewsController } from './admin-reviews.controller';
import { SellerReviewsController } from './seller-reviews.controller';

@Module({
  imports: [ShopsModule, ProductCardsModule, NotificationsModule],
  controllers: [
    ReviewsController,
    AdminReviewsController,
    SellerReviewsController,
  ],
  providers: [
    openrouterClientProvider,
    ReviewsRepository,
    ReviewsAiService,
    ReviewsService,
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
