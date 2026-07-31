import { Module } from '@nestjs/common';
import { openaiClientProvider } from '../openai/openai-client.provider';
import { SettingsModule } from '../settings/settings.module';
import { AiChecksRepository } from './ai-checks.repository';
import { AiChecksService } from './ai-checks.service';

@Module({
  imports: [SettingsModule],
  providers: [openaiClientProvider, AiChecksRepository, AiChecksService],
  exports: [AiChecksService],
})
export class AiModule {}
