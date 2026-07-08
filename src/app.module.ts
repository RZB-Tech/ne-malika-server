import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { DbModule } from './db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesGuard } from './common/guards/roles.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guards';
import { BotModule } from './modules/bot/bot.module';
import { ShopsModule } from './modules/shops/shops.module';
import { ProductCardsModule } from './modules/product-cards/product-cards.module';
import { FilesModule } from './modules/files/files.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AiModule } from './modules/ai/ai.module';
import { OpenAiModule } from './modules/openai/openai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DbModule,
    OpenAiModule,
    AuthModule,
    UsersModule,
    BotModule,
    ShopsModule,
    ProductCardsModule,
    FilesModule,
    ReportsModule,
    AiModule,

    // ShopsModule, ProductCardsModule, ReportsModule, SearchModule,
    // StatsModule, FilesModule, AiModule, BotModule — далее
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
