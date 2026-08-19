import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CategoriesModule } from '../categories/categories.module';
import { ShopsModule } from '../shops/shops.module';
import { CreditsModule } from '../credits/credits.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { openrouterClientProvider } from '../openrouter/openrouter-client.provider';
import { ProductAutofillService } from './product-autofill.service';
import { ProductAutofillController } from './product-autofill.controller';

/**
 * Автозаполнение карточки товара по фотографиям.
 *
 * Своего хранилища у модуля нет: результат никуда не пишется, а возвращается в
 * форму, где продавец его правит и сохраняет обычным запросом на товар. Иначе
 * пришлось бы решать, что делать с заполнением, которое продавец не принял.
 */
@Module({
  imports: [
    FilesModule,
    CategoriesModule,
    ShopsModule,
    CreditsModule,
    AiUsageModule,
  ],
  controllers: [ProductAutofillController],
  providers: [openrouterClientProvider, ProductAutofillService],
})
export class ProductAutofillModule {}
