import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StatsRangeQueryDto {
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

export class DailyPointDto {
  @ApiProperty({ description: 'Сутки, YYYY-MM-DD', example: '2026-08-18' })
  date: string;

  @ApiProperty({ description: 'Просмотров за эти сутки', example: 42 })
  views: number;

  @ApiProperty({
    description: 'Уникальных посетителей за эти сутки',
    example: 31,
  })
  visitors: number;
}

export class ProductStatsDto {
  @ApiProperty({ description: 'Просмотры за период', example: 451 })
  views: number;

  @ApiProperty({ description: 'Просмотры за последние 7 дней', example: 88 })
  views7d: number;

  @ApiProperty({
    description: 'Посещений за период — сумма уникальных по дням',
    example: 297,
  })
  visits: number;

  @ApiProperty({ description: 'Раскрытий телефона за период', example: 24 })
  phoneClicks: number;

  @ApiProperty({ description: 'Переходов в Telegram за период', example: 61 })
  telegramClicks: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 70,
  })
  contactVisitors: number;

  @ApiProperty({
    description: 'Разбивка по дням от старого к новому, без пропусков',
    type: [DailyPointDto],
  })
  daily: DailyPointDto[];
}
