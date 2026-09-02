import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { BANNER_SOURCE_PRODUCTS } from '../banners.constants';

const ACCENT_MAX = 200;

export class GenerateBannerDto {
  @ApiPropertyOptional({
    type: [Number],
    maxItems: BANNER_SOURCE_PRODUCTS,
    example: [10, 12],
    description:
      'Какие товары показать на баннере. Пусто — возьмём последние ' +
      'опубликованные товары магазина.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BANNER_SOURCE_PRODUCTS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];

  @ApiPropertyOptional({
    maxLength: ACCENT_MAX,
    example: 'Осенняя распродажа ноутбуков',
    description:
      'О чём баннер. Пусто — модель напишет текст по названию магазина и его товарам.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ACCENT_MAX)
  accent?: string;
}

/**
 * Второй язык рисуется поверх уже принятой картинки, поэтому здесь нужен её
 * ключ, а не описание заново: продавец согласился с конкретной вёрсткой.
 */
export class TranslateBannerDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Ключ русского баннера из POST /seller/banners/ai/ru — тот, который понравился',
  })
  @IsUUID('4')
  photoKey: string;
}

export class GeneratedBannerDto {
  @ApiProperty({ format: 'uuid', description: 'Ключ картинки в S3' })
  key: string;

  @ApiProperty({ description: 'Готовый адрес картинки' })
  url: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Остаток кредитов после списания. null — списания не было',
    example: 8235,
  })
  balance: number | null;
}

export class BannerAiPriceDto {
  @ApiProperty({
    description: 'Во сколько кредитов обойдётся одна картинка',
    example: 165,
  })
  price: number;

  @ApiProperty({
    description: 'Хватает ли кредитов и позволяет ли тариф',
    example: true,
  })
  allowed: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Доступный остаток кредитов магазина',
    example: 8400,
  })
  balance: number | null;
}
