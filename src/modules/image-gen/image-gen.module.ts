import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { ImageGenRepository } from './image-gen.repository';
import { ImageGenService } from './image-gen.service';
import {
  AdminImageGenController,
  ImageGenController,
} from './admin-image-gen.controller';

@Module({
  imports: [FilesModule],
  controllers: [ImageGenController, AdminImageGenController],
  providers: [openrouterClientProvider, ImageGenRepository, ImageGenService],
  exports: [ImageGenService],
})
export class ImageGenModule {}
