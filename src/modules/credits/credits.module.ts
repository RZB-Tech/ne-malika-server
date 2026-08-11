import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import {
  AdminCreditsController,
  AdminCreditsPreviewController,
} from './admin-credits.controller';
import { CreditsRepository } from './credits.repository';
import { CreditsService } from './credits.service';

/**
 * Кредиты магазинов на ИИ: выдача администратором и списание при обращении к
 * моделям. Наружу экспортируется только сервис — image-gen не должен знать ни
 * про журнал операций, ни про настройку множителя.
 */
@Module({
  imports: [SettingsModule],
  controllers: [AdminCreditsController, AdminCreditsPreviewController],
  providers: [CreditsRepository, CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
