import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CategoriesModule } from '../categories/categories.module';
import { ShopsModule } from '../shops/shops.module';
import { CreditsModule } from '../credits/credits.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { OpenrouterModule } from '../openrouter/openrouter.module';
import { ProductAutofillService } from './product-autofill.service';
import { ProductAutofillController } from './product-autofill.controller';

@Module({
  imports: [
    OpenrouterModule,
    FilesModule,
    CategoriesModule,
    ShopsModule,
    CreditsModule,
    AiUsageModule,
  ],
  controllers: [ProductAutofillController],
  providers: [ProductAutofillService],
})
export class ProductAutofillModule {}
