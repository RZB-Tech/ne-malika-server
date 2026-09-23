import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const PAYMENT_REVIEW_ACTIONS = [
  'mark_resolved',
  'grant_paid_subscription',
] as const;

export type PaymentReviewAction = (typeof PAYMENT_REVIEW_ACTIONS)[number];

export class ResolvePaymentReviewDto {
  @ApiProperty({ enum: PAYMENT_REVIEW_ACTIONS })
  @IsIn([...PAYMENT_REVIEW_ACTIONS])
  action: PaymentReviewAction;

  @ApiProperty({ minLength: 5, maxLength: 1000 })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
