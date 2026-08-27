import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  paymentProviderEnum,
  paymentStatusEnum,
} from '../../../db/schema/enums';
import { PAID_PLANS, type PaidPlan } from '../subscriptions.constants';

const PAYMENT_STATUS_VALUES = [...paymentStatusEnum.enumValues];
const PAYMENT_PROVIDER_VALUES = [...paymentProviderEnum.enumValues];

export class SubscriptionReportQueryDto {
  @ApiProperty({
    description: 'Глубина периода в днях, считая сегодняшний',
    required: false,
    default: 30,
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class SubscriptionSalesPointDto {
  @ApiProperty({ description: 'Сутки, YYYY-MM-DD', example: '2026-08-18' })
  date: string;

  @ApiProperty({ description: 'Выручка за сутки в сумах', example: 1470000 })
  revenue: number;

  @ApiProperty({ description: 'Оплат за сутки', example: 7 })
  payments: number;

  @ApiProperty({ description: 'Выручка по тарифу start', example: 210000 })
  start: number;

  @ApiProperty({ description: 'Выручка по тарифу pro', example: 660000 })
  pro: number;

  @ApiProperty({ description: 'Выручка по тарифу max', example: 600000 })
  max: number;
}

export class SubscriptionPlanSliceDto {
  @ApiProperty({ enum: PAID_PLANS })
  plan: PaidPlan;

  @ApiProperty({ description: 'Оплат за период', example: 12 })
  payments: number;

  @ApiProperty({ description: 'Выручка за период в сумах', example: 2520000 })
  revenue: number;
}

export class SubscriptionProviderSliceDto {
  @ApiProperty({ enum: PAYMENT_PROVIDER_VALUES })
  provider: string;

  @ApiProperty({ description: 'Оплат за период', example: 12 })
  payments: number;

  @ApiProperty({ description: 'Выручка за период в сумах', example: 2520000 })
  revenue: number;
}

export class SubscriptionStatusSliceDto {
  @ApiProperty({ enum: PAYMENT_STATUS_VALUES })
  status: string;

  @ApiProperty({ description: 'Счетов в этом состоянии за период', example: 4 })
  payments: number;
}

export class SubscriptionTopShopDto {
  @ApiProperty({ example: 41 })
  shopId: number;

  @ApiProperty({ example: 'Компьютерный мир' })
  name: string;

  @ApiProperty({ description: 'Оплат за период', example: 3 })
  payments: number;

  @ApiProperty({ description: 'Выручка за период в сумах', example: 900000 })
  revenue: number;
}

export class SubscriptionActivePlanDto {
  @ApiProperty({ enum: PAID_PLANS })
  plan: PaidPlan;

  @ApiProperty({
    description: 'Магазинов с действующей подпиской',
    example: 18,
  })
  shops: number;
}

export class SubscriptionReportDto {
  @ApiProperty({
    description: 'Ряд по дням от старого к новому, без пропусков',
    type: [SubscriptionSalesPointDto],
  })
  daily: SubscriptionSalesPointDto[];

  @ApiProperty({
    description: 'Выручка по тарифам в порядке самих тарифов: start, pro, max',
    type: [SubscriptionPlanSliceDto],
  })
  byPlan: SubscriptionPlanSliceDto[];

  @ApiProperty({
    description: 'Разбивка по платёжным провайдерам',
    type: [SubscriptionProviderSliceDto],
  })
  byProvider: SubscriptionProviderSliceDto[];

  @ApiProperty({
    description:
      'Чем закончились выставленные за период счёта. Считаются все, ' +
      'включая неоплаченные — по ним и виден процент доходимости',
    type: [SubscriptionStatusSliceDto],
  })
  byStatus: SubscriptionStatusSliceDto[];

  @ApiProperty({
    description: 'Магазины с наибольшей выручкой за период, до 8 штук',
    type: [SubscriptionTopShopDto],
  })
  topShops: SubscriptionTopShopDto[];

  @ApiProperty({
    description: 'Срез на сейчас: сколько магазинов сидит на каждом тарифе',
    type: [SubscriptionActivePlanDto],
  })
  activeByPlan: SubscriptionActivePlanDto[];

  @ApiProperty({ description: 'Выручка за период в сумах', example: 5040000 })
  revenue: number;

  @ApiProperty({ description: 'Оплат за период', example: 24 })
  payments: number;

  @ApiProperty({
    description: 'Средний чек в сумах, округлён до целого',
    example: 210000,
  })
  avgCheck: number;

  @ApiProperty({ description: 'Сколько магазинов заплатило', example: 19 })
  payingShops: number;

  @ApiProperty({
    description: 'Выручка с магазинов, заплативших за подписку впервые',
    example: 1680000,
  })
  newRevenue: number;

  @ApiProperty({
    description: 'Выручка с продлений — у магазина уже была оплата раньше',
    example: 3360000,
  })
  renewalRevenue: number;

  @ApiProperty({
    description: 'Магазинов с действующей подпиской на сейчас',
    example: 31,
  })
  activeShops: number;

  @ApiProperty({
    description:
      'Доходимость до оплаты в процентах: оплаченные счёта к выставленным',
    example: 68,
  })
  conversion: number;

  @ApiProperty({
    description: 'Тестовых оплат за период — в выручку не попали',
    example: 2,
  })
  excludedTest: number;

  @ApiProperty({
    description:
      'Оплат, по которым провайдер вернул деньги — в выручку не попали',
    example: 1,
  })
  excludedRefunded: number;
}
