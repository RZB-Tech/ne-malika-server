import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import {
  AdminCreditsController,
  AdminCreditsPreviewController,
} from './admin-credits.controller';
import { SellerCreditsController } from './seller-credits.controller';
import { CreditsRepository } from './credits.repository';
import { CreditsService } from './credits.service';

/**
 * Кредиты магазинов на ИИ: выдача администратором, выдача нормы подписки,
 * списание при обращении к моделям и журнал того и другого. Наружу
 * экспортируется только сервис — ни image-gen, ни подписки не должны знать ни
 * про устройство журнала, ни про настройку множителя.
 *
 * Модуль тарифов сюда не импортируется и не будет: правила тарифов лежат
 * отдельным файлом без зависимостей (`subscriptions.constants.ts`) именно
 * затем, что `SubscriptionsModule` сам зависит от кредитов — выдавать норму
 * ему. Импорт в обратную сторону замкнул бы кольцо.
 */
@Module({
  imports: [SettingsModule],
  controllers: [
    AdminCreditsController,
    AdminCreditsPreviewController,
    SellerCreditsController,
  ],
  providers: [CreditsRepository, CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
