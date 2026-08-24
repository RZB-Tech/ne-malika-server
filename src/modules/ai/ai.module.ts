import { Module } from '@nestjs/common';
import { OpenrouterModule } from '../openrouter/openrouter.module';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategoriesModule } from '../categories/categories.module';
import { AiChecksRepository } from './ai-checks.repository';
import { AiChecksService } from './ai-checks.service';

@Module({
  imports: [
    OpenrouterModule,
    SettingsModule,
    FilesModule,
    NotificationsModule,
    CategoriesModule,
  ],
  providers: [AiChecksRepository, AiChecksService],
  exports: [AiChecksService],
})
export class AiModule {}
