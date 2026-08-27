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

/**
 * Подписка магазина: тарифы, оплата через Click, выдача подписочных кредитов,
 * ручные действия администратора и напоминания об истечении.
 *
 * Зависимости идут только в одну сторону — `Subscriptions → {Credits,
 * Notifications, SearchStats}`, — и это не случайность, а условие, при котором
 * тарифы вообще работают. Знание «жива ли подписка и что она даёт» вынесено
 * файлами, а не модулями: `subscriptions.constants.ts` (`effectiveLimits`,
 * `PLAN_LIMITS`) и `src/db/subscriptions.ts` (`SUBSCRIPTION_ACTIVE`,
 * `AVAILABLE_CREDITS`). Ими пользуются кредиты, витрина, баннеры и аналитика —
 * не заводя обратной ссылки на этот модуль. `forwardRef` в репозитории не
 * встречается ни разу, и заводить его здесь незачем.
 *
 * `ShopsModule` не импортируется, в отличие от первоначального плана: магазин
 * подписке нужен вместе с telegram-id владельца (он уходит в кассу как
 * `merchant_trans_id`), и с отказом `403` вместо `404`, — а
 * `ShopsService.getActiveOwnShopOrThrow` не даёт ни того, ни другого. Разбор —
 * в докблоке `SubscriptionsService.shopOfOwner`. Неиспользуемый импорт молча
 * утверждал бы обратное.
 *
 * `SearchStatsModule` нужен не подпискам, а ночной уборке: единственное в
 * приложении расписание уборки живёт в `SubscriptionRemindersService`, и оно
 * же чистит `shop_search_hits_daily`. Разбор — в докблоке того сервиса.
 *
 * `RedisModule` не указан намеренно — он объявлен `@Global`.
 */
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
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
