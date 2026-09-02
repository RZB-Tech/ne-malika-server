import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OpenrouterModule } from '../openrouter/openrouter.module';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { CreditsModule } from '../credits/credits.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { BannersRepository } from './banners.repository';
import { BannersService } from './banners.service';
import { BannerAiService } from './banner-ai.service';
import { BannersController } from './banners.controller';
import { AdminBannersController } from './admin-banners.controller';
import { SellerBannersController } from './seller-banners.controller';
import { SellerBannerAiController } from './seller-banner-ai.controller';
import { AdminShopBannersController } from './admin-shop-banners.controller';

@Module({
  imports: [
    ShopsModule,
    FilesModule,
    NotificationsModule,
    OpenrouterModule,
    ProductCardsModule,
    CreditsModule,
    AiUsageModule,
  ],
  controllers: [
    BannersController,
    AdminBannersController,
    SellerBannersController,
    SellerBannerAiController,
    AdminShopBannersController,
  ],
  providers: [BannersRepository, BannersService, BannerAiService],
  exports: [BannersService],
})
export class BannersModule {}
