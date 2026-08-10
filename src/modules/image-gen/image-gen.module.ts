import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { AiModule } from '../ai/ai.module';
import { openaiImageClientProvider } from './openai-image.provider';
import { ImageGenService } from './image-gen.service';
import { AdminImageGenController } from './admin-image-gen.controller';

/** AiModule — ради клиента Groq: им пишется промпт по фотографии. */
@Module({
  imports: [FilesModule, AiModule],
  controllers: [AdminImageGenController],
  providers: [openaiImageClientProvider, ImageGenService],
  exports: [ImageGenService],
})
export class ImageGenModule {}
