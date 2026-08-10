import { Module } from '@nestjs/common';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';
import { AiChecksRepository } from './ai-checks.repository';
import { AiChecksService } from './ai-checks.service';

@Module({
  imports: [SettingsModule, FilesModule],
  providers: [openrouterClientProvider, AiChecksRepository, AiChecksService],
  exports: [AiChecksService],
})
export class AiModule {}
