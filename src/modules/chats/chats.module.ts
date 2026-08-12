import { Module } from '@nestjs/common';
import { ShopsModule } from '../shops/shops.module';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatsRepository } from './chats.repository';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';

@Module({
  imports: [ShopsModule, ProductCardsModule, NotificationsModule],
  controllers: [ChatsController],
  providers: [ChatsRepository, ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
