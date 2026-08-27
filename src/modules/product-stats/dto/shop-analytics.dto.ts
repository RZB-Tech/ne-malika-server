import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { StatsRangeQueryDto } from './product-stats.dto';

export class ShopDailyPointDto {
  @ApiProperty({ description: 'Сутки, YYYY-MM-DD', example: '2026-08-18' })
  date: string;

  @ApiProperty({
    description: 'Просмотров карточек за эти сутки',
    example: 312,
  })
  views: number;

  @ApiProperty({
    description: 'Посетителей за эти сутки — сумма уникальных по товарам',
    example: 204,
  })
  visitors: number;

  @ApiProperty({ description: 'Раскрытий телефона за эти сутки', example: 18 })
  phoneClicks: number;

  @ApiProperty({
    description: 'Переходов в Telegram за эти сутки',
    example: 26,
  })
  telegramClicks: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 33,
  })
  contactVisitors: number;
}

export class TopProductDto {
  @ApiProperty({ description: 'Идентификатор товара', example: 4821 })
  id: number;

  @ApiProperty({ description: 'Название товара', example: 'Ноутбук ASUS X515' })
  name: string;

  @ApiProperty({ description: 'Просмотры за период', example: 512 })
  views: number;

  @ApiProperty({
    description: 'Посещения за период — сумма уникальных по дням',
    example: 340,
  })
  visits: number;

  @ApiProperty({
    description: 'Контакты: раскрытия телефона плюс переходы в Telegram',
    example: 47,
  })
  contacts: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 38,
  })
  contactVisitors: number;

  @ApiProperty({
    description: 'Доля дошедших до контакта, целых процентов от 0 до 100',
    example: 11,
  })
  conversionPercent: number;
}

export class ShopAnalyticsDto {
  @ApiProperty({ description: 'Идентификатор магазина', example: 42 })
  shopId: number;

  @ApiProperty({
    description: 'Название магазина',
    example: 'Малика Электроникс',
  })
  shopName: string;

  @ApiProperty({
    description: 'Первые сутки периода, YYYY-MM-DD',
    example: '2026-07-20',
  })
  from: string;

  @ApiProperty({
    description: 'Последние сутки периода, YYYY-MM-DD',
    example: '2026-08-18',
  })
  to: string;

  @ApiProperty({ description: 'Просмотры за период', example: 9312 })
  views: number;

  @ApiProperty({
    description: 'Посещений за период — сумма уникальных по дням и товарам',
    example: 6104,
  })
  visits: number;

  @ApiProperty({ description: 'Раскрытий телефона за период', example: 402 })
  phoneClicks: number;

  @ApiProperty({ description: 'Переходов в Telegram за период', example: 611 })
  telegramClicks: number;

  @ApiProperty({
    description: 'Контакты: раскрытия телефона плюс переходы в Telegram',
    example: 1013,
  })
  contacts: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 780,
  })
  contactVisitors: number;

  @ApiProperty({
    description: 'Доля дошедших до контакта, целых процентов от 0 до 100',
    example: 12,
  })
  conversionPercent: number;

  @ApiProperty({
    description: 'Ряд по дням от старого к новому, без пропусков',
    type: [ShopDailyPointDto],
  })
  daily: ShopDailyPointDto[];

  @ApiProperty({
    description: 'Самые просматриваемые товары периода',
    type: [TopProductDto],
  })
  topProducts: TopProductDto[];
}

export class SearchHitsQueryDto extends StatsRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Сколько запросов вернуть',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
