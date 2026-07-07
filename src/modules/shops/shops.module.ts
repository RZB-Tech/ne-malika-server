import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ShopsRepository } from './shops.repository';
import { ShopsService } from './shops.service';
import { ShopsController } from './shops.controller';
import { SellerShopsController } from './seller-shops.controller';
import { AdminShopsController } from './admin-shops.controller';

@Module({
  imports: [UsersModule],
  controllers: [ShopsController, SellerShopsController, AdminShopsController],
  providers: [ShopsRepository, ShopsService],
  exports: [ShopsService, ShopsRepository],
})
export class ShopsModule {}
