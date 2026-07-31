import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const ADMIN_PRODUCT_STATUSES = [
  'active',
  'hidden',
  'abolished',
] as const;

/**
 * Выдача для администратора: в отличие от публичной, статус здесь фильтр,
 * а не жёсткое условие — иначе упразднённые товары негде было бы посмотреть.
 */
export class FindAdminProductCardsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Поиск по названию', example: 'ноутбук' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: ADMIN_PRODUCT_STATUSES,
    description: 'Без параметра возвращаются товары во всех статусах',
  })
  @IsOptional()
  @IsIn(ADMIN_PRODUCT_STATUSES)
  status?: (typeof ADMIN_PRODUCT_STATUSES)[number];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;
}
