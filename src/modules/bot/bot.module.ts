import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { TelegramApiService } from './telegram-api.service';
import { AdminCallbackRegistry } from './admin-callback.registry';

@Module({
  imports: [UsersModule],
  controllers: [BotController],
  providers: [TelegramApiService, BotService, AdminCallbackRegistry],
  exports: [TelegramApiService, AdminCallbackRegistry],
})
export class BotModule {}
