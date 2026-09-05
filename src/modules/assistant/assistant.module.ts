import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { OpenrouterModule } from '../openrouter/openrouter.module';
import { ProductCardsModule } from '../product-cards/product-cards.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [OpenrouterModule, ProductCardsModule, CategoriesModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
