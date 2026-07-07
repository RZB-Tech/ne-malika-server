import { Module } from '@nestjs/common';
import { s3ClientProvider } from './s3-client.provider';
import { FilesService } from './files.service';
import { SellerFilesController } from './seller-files.controller';

@Module({
  controllers: [SellerFilesController],
  providers: [s3ClientProvider, FilesService],
  exports: [FilesService],
})
export class FilesModule {}
