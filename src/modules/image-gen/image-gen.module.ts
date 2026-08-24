import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CreditsModule } from '../credits/credits.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { OpenrouterModule } from '../openrouter/openrouter.module';
import { ImageGenRepository } from './image-gen.repository';
import { ImageGenService } from './image-gen.service';
import { ImageGenController } from './admin-image-gen.controller';

@Module({
  imports: [OpenrouterModule, FilesModule, CreditsModule, AiUsageModule],
  controllers: [ImageGenController],
  providers: [ImageGenRepository, ImageGenService],
  exports: [ImageGenService],
})
export class ImageGenModule {}
