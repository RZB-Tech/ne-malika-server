import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AdminReportsController } from './admin-reports.controller';

@Module({
  imports: [ShopsModule, ProductCardsModule, NotificationsModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsRepository, ReportsService],
})
export class ReportsModule {}
