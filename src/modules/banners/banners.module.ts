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

/**
 * Карусель главной страницы: баннеры площадки и платные баннеры продавцов с
 * тарифа MAX, живущие в той же таблице.
 *
 * Три импорта — три чужие обязанности, которые модуль не берёт на себя:
 * `ShopsModule` разрешает магазин по владельцу (и только он знает, что значит
 * «активный магазин»), `FilesModule` отвечает за существование картинки в S3,
 * `NotificationsModule` — за доставку решения модератора продавцу.
 *
 * Кольца ни один из них не создаёт: `ShopsModule` зависит от пользователей и
 * кредитов, `NotificationsModule` — от бота, `FilesModule` — ни от чего, и про
 * баннеры не знает никто из них. Тариф при этом берётся не из
 * `SubscriptionsModule`, а файлом констант (`effectiveLimits`): сам модуль
 * подписок зависит от кредитов, и импорт его сюда рано или поздно замкнул бы
 * кольцо — ровно поэтому правила тарифов и объявлены отдельным файлом без
 * провайдеров.
 */
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
