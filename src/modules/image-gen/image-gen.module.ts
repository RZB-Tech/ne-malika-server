import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CreditsModule } from '../credits/credits.module';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { ImageGenRepository } from './image-gen.repository';
import { ImageGenService } from './image-gen.service';
import { ImageGenController } from './admin-image-gen.controller';

@Module({
  imports: [FilesModule, CreditsModule],
  controllers: [ImageGenController],
  providers: [openrouterClientProvider, ImageGenRepository, ImageGenService],
  exports: [ImageGenService],
})
export class ImageGenModule {}
