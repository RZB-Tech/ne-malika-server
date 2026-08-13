import { Module } from '@nestjs/common';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategoriesModule } from '../categories/categories.module';
import { AiChecksRepository } from './ai-checks.repository';
import { AiChecksService } from './ai-checks.service';

@Module({
  imports: [SettingsModule, FilesModule, NotificationsModule, CategoriesModule],
  providers: [openrouterClientProvider, AiChecksRepository, AiChecksService],
  exports: [AiChecksService],
})
export class AiModule {}
