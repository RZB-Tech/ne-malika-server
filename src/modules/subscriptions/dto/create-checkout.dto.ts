import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PAID_PLANS, type PaidPlan } from '../subscriptions.constants';

export class CreateCheckoutDto {
  @ApiProperty({
    enum: PAID_PLANS,
    description: 'Тариф, за который платим',
    example: 'pro',
  })
  @IsIn([...PAID_PLANS], { message: 'Неизвестный тариф' })
  plan: PaidPlan;
}
