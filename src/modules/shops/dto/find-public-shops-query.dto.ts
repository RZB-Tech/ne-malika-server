import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const PUBLIC_SHOP_SORTS = [
  'products',
  'rating',
  'newest',
  'name',
] as const;

export type PublicShopSort = (typeof PUBLIC_SHOP_SORTS)[number];

export class FindPublicShopsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Текстовый поиск по названию и адресу магазина',
    example: 'техно',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    enum: PUBLIC_SHOP_SORTS,
    default: 'products',
    description:
      'products — сначала магазины с наибольшим ассортиментом (по умолчанию: ' +
      'покупателю нужен выбор, а не магазин с одной оценкой); rating — ' +
      'по средней оценке, магазины без отзывов уходят в конец',
  })
  @IsOptional()
  @IsIn(PUBLIC_SHOP_SORTS)
  sort?: PublicShopSort;
}
