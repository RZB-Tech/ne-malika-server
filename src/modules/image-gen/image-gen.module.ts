import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { openaiImageClientProvider } from './openai-image.provider';
import { ImageGenService } from './image-gen.service';
import { AdminImageGenController } from './admin-image-gen.controller';

@Module({
  imports: [FilesModule],
  controllers: [AdminImageGenController],
  providers: [openaiImageClientProvider, ImageGenService],
  exports: [ImageGenService],
})
export class ImageGenModule {}
