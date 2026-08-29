import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CHECKOUT_PROVIDERS,
  type CheckoutProvider,
} from '../subscriptions.constants';

/**
 * Фейковый счёт для проверки кассы и прогона песочницы. Сумма задаётся
 * руками: в песочнице Payme её вбивают в запросы вместе с номером заказа.
 */
export class CreateTestPaymentDto {
  @ApiPropertyOptional({
    enum: CHECKOUT_PROVIDERS,
    description: 'Касса, для которой заводим счёт. По умолчанию Click',
    example: 'payme',
  })
  @IsOptional()
  @IsIn([...CHECKOUT_PROVIDERS], { message: 'Неизвестная касса' })
  provider?: CheckoutProvider;

  @ApiPropertyOptional({
    description:
      'Сумма счёта в сумах. По умолчанию SUBSCRIPTION_TEST_PRICE_UZS. ' +
      'Не должна совпадать с ценой боевого тарифа',
    minimum: 1,
    maximum: 100_000_000,
    example: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Сумма указывается целым числом сумов' })
  @Min(1)
  @Max(100_000_000)
  amountUzs?: number;
}
