import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { SellerNudgeService } from './seller-nudge.service';

/**
 * Уведомления в Telegram: точечные (админам), напоминания продавцам и
 * рассылка из админки.
 *
 * Модуль экспортирует только сервис — модули, которые шлют уведомления
 * (жалобы, ИИ-проверка), не должны знать ни про репозиторий, ни про бота.
 */
@Module({
  imports: [BotModule],
  controllers: [AdminBroadcastsController],
  providers: [NotificationsRepository, NotificationsService, SellerNudgeService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
