import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { DbModule } from './db/db.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesGuard } from './common/guards/roles.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { BotModule } from './modules/bot/bot.module';
import { ShopsModule } from './modules/shops/shops.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductCardsModule } from './modules/product-cards/product-cards.module';
import { AiCompareModule } from './modules/ai-compare/ai-compare.module';
import { ProductViewsModule } from './modules/product-views/product-views.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { FilesModule } from './modules/files/files.module';
import { ImageGenModule } from './modules/image-gen/image-gen.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ChatsModule } from './modules/chats/chats.module';
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CreditsModule } from './modules/credits/credits.module';
import { AiUsageModule } from './modules/ai-usage/ai-usage.module';
import { BannersModule } from './modules/banners/banners.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    DbModule,
    RedisModule,
    AuthModule,
    UsersModule,
    BotModule,
    ShopsModule,
    CategoriesModule,
    ProductCardsModule,
    AiCompareModule,
    ProductViewsModule,
    FavoritesModule,
    FilesModule,
    ImageGenModule,
    ReportsModule,
    ReviewsModule,
    ChatsModule,
    SettingsModule,
    NotificationsModule,
    CreditsModule,
    AiUsageModule,
    BannersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
