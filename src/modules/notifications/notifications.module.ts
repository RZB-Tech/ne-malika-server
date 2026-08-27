import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { NotificationsController } from './notifications.controller';
import { PushController } from './push.controller';
import { PushRepository } from './push.repository';
import { PushService } from './push.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { SellerNudgeService } from './seller-nudge.service';

@Module({
  imports: [BotModule],
  controllers: [
    AdminBroadcastsController,
    NotificationsController,
    PushController,
  ],
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
