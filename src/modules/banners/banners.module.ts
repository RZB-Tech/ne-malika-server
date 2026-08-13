import { Module } from '@nestjs/common';
import { BannersRepository } from './banners.repository';
import { BannersService } from './banners.service';
import { BannersController } from './banners.controller';
import { AdminBannersController } from './admin-banners.controller';

@Module({
  controllers: [BannersController, AdminBannersController],
  providers: [BannersRepository, BannersService],
  exports: [BannersService],
})
export class BannersModule {}
