import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { TelegramApiService } from './telegram-api.service';

@Module({
  imports: [UsersModule],
  controllers: [BotController],
  providers: [TelegramApiService, BotService],
  exports: [TelegramApiService],
})
export class BotModule {}
