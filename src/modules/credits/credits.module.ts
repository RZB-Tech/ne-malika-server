import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import {
  AdminCreditsController,
  AdminCreditsPreviewController,
} from './admin-credits.controller';
import { SellerCreditsController } from './seller-credits.controller';
import { CreditsRepository } from './credits.repository';
import { CreditsService } from './credits.service';

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
