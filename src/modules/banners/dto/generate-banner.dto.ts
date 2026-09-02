import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { BANNER_SOURCE_PRODUCTS } from '../banners.constants';

/**
 * Тело запроса на баннер пустое не случайно: продавцу нечего вводить.
 * Название, замысел и надписи придумывает модель, разобрав магазин, а ссылка
 * ведёт на его же страницу. Единственная ручка — выбрать товары, если не
 * устраивают последние опубликованные.
 */
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
}

/** То же от лица администратора: магазин он выбирает сам. */
export class AdminGenerateBannerDto extends GenerateBannerDto {
  @ApiProperty({
    example: 12,
    description: 'Магазин, для которого рисуем баннер',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shopId: number;
}

/**
 * Второй язык рисуется поверх уже принятой картинки, поэтому здесь нужен её
 * ключ, а не описание заново: продавец согласился с конкретной вёрсткой.
 */
export class TranslateBannerDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Ключ русского баннера из POST .../ai/ru — тот, который понравился',
  })
  @IsUUID('4')
  photoKey: string;
}

export class AdminTranslateBannerDto extends TranslateBannerDto {
  @ApiProperty({
    example: 12,
    description: 'Тот же магазин, что и на первом шаге',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shopId: number;
}

export class GeneratedBannerDto {
  @ApiProperty({ format: 'uuid', description: 'Ключ картинки в S3' })
  key: string;

  @ApiProperty({ description: 'Готовый адрес картинки' })
  url: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Баннер магазина «ТехноМаркет» — ноутбуки',
    description:
      'Название баннера, придуманное моделью. У перевода пусто: название ' +
      'уже выбрано на первом шаге и не меняется',
  })
  title: string | null;

  @ApiProperty({
    example: '/store/12',
    description: 'Куда ведёт клик — страница магазина, подставляется сама',
  })
  linkUrl: string;

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
    description:
      'Доступный остаток кредитов магазина. null — списания не будет ' +
      '(администратор) либо тариф не даёт баннер',
    example: 8400,
  })
  balance: number | null;
}
