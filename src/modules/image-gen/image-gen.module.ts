import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { ImageGenService } from './image-gen.service';
import { AdminImageGenController } from './admin-image-gen.controller';

@Module({
  imports: [FilesModule],
  controllers: [AdminImageGenController],
  providers: [openrouterClientProvider, ImageGenService],
  exports: [ImageGenService],
})
export class ImageGenModule {}
