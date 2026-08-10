import { Module } from '@nestjs/common';
import { groqClientProvider } from '../groq/groq-client.provider';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';
import { AiChecksRepository } from './ai-checks.repository';
import { AiChecksService } from './ai-checks.service';

@Module({
  imports: [SettingsModule, FilesModule],
  providers: [groqClientProvider, AiChecksRepository, AiChecksService],
  exports: [AiChecksService],
})
export class AiModule {}
