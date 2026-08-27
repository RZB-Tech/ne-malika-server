import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SearchStatsModule } from '../search-stats/search-stats.module';
import { SubscriptionsController } from './subscriptions.controller';
import { ClickController } from './click.controller';
import { SellerSubscriptionsController } from './seller-subscriptions.controller';
import {
  AdminShopSubscriptionController,
  AdminSubscriptionsController,
} from './admin-subscriptions.controller';
import { ClickMerchantService } from './click-merchant.service';
import { SubscriptionRemindersService } from './subscription-reminders.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [CreditsModule, NotificationsModule, SearchStatsModule],
  controllers: [
    SubscriptionsController,
    ClickController,
    SellerSubscriptionsController,
    AdminSubscriptionsController,
    AdminShopSubscriptionController,
  ],
  providers: [
    SubscriptionsRepository,
    SubscriptionsService,
    ClickMerchantService,
    SubscriptionRemindersService,
  ],
})
export class SubscriptionsModule {}
