import { Module } from '@nestjs/common';
import { GROQ_CLIENT, groqClientProvider } from '../groq/groq-client.provider';
import { SettingsModule } from '../settings/settings.module';
import { AiChecksRepository } from './ai-checks.repository';
import { AiChecksService } from './ai-checks.service';

@Module({
  imports: [SettingsModule],
  providers: [groqClientProvider, AiChecksRepository, AiChecksService],
  exports: [AiChecksService, GROQ_CLIENT],
})
export class AiModule {}
