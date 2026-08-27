import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BannersRepository } from './banners.repository';
import { BannersService } from './banners.service';
import { BannersController } from './banners.controller';
import { AdminBannersController } from './admin-banners.controller';
import { SellerBannersController } from './seller-banners.controller';
import { AdminShopBannersController } from './admin-shop-banners.controller';

@Module({
  imports: [ShopsModule, FilesModule, NotificationsModule],
  controllers: [
    BannersController,
    AdminBannersController,
    SellerBannersController,
    AdminShopBannersController,
  ],
  providers: [BannersRepository, BannersService],
  exports: [BannersService],
})
export class BannersModule {}
