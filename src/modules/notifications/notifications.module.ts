import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { PushController } from './push.controller';
import { PushRepository } from './push.repository';
import { PushService } from './push.service';
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
  controllers: [AdminBroadcastsController, PushController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    SellerNudgeService,
    PushRepository,
    PushService,
  ],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
