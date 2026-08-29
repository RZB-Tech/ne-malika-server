import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  CHECKOUT_PROVIDERS,
  PAID_PLANS,
  type CheckoutProvider,
  type PaidPlan,
} from '../subscriptions.constants';

export class CreateCheckoutDto {
  @ApiProperty({
    enum: PAID_PLANS,
    description: 'Тариф, за который платим',
    example: 'pro',
  })
  @IsIn([...PAID_PLANS], { message: 'Неизвестный тариф' })
  plan: PaidPlan;

  @ApiPropertyOptional({
    enum: CHECKOUT_PROVIDERS,
    description: 'Касса, через которую платим. По умолчанию Click',
    example: 'click',
  })
  @IsOptional()
  @IsIn([...CHECKOUT_PROVIDERS], { message: 'Неизвестная касса' })
  provider?: CheckoutProvider;
}
