import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MANUAL_ACTIVATION_MAX_MONTHS,
  PAID_PLANS,
  type PaidPlan,
} from '../subscriptions.constants';

export class ActivateSubscriptionDto {
  @ApiProperty({
    enum: PAID_PLANS,
    description: 'Тариф, который выдаём',
    example: 'max',
  })
  @IsIn([...PAID_PLANS], { message: 'Неизвестный тариф' })
  plan: PaidPlan;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MANUAL_ACTIVATION_MAX_MONTHS,
    default: 1,
    description:
      'Сколько месяцев выдать одной операцией. Кредиты начисляются в том же ' +
      'кратном размере: норма тарифа, умноженная на число месяцев',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MANUAL_ACTIVATION_MAX_MONTHS)
  months?: number;

  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Зачем выдали: номер платёжного поручения, номер обращения, ' +
      'договорённость. Виден в журнале платежей магазина',
    example: 'Оплата по счёту №142 от 12.08',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
