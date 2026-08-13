import { Module } from '@nestjs/common';
import { AiUsageRepository } from './ai-usage.repository';
import { AiUsageService } from './ai-usage.service';
import { AdminAiUsageController } from './admin-ai-usage.controller';

@Module({
  controllers: [AdminAiUsageController],
  providers: [AiUsageRepository, AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
