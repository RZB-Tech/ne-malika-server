import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const ADMIN_PRODUCT_STATUSES = [
  'active',
  'hidden',
  'abolished',
  'pending',
] as const;

export class FindAdminProductCardsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Поиск по названию', example: 'ноутбук' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
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

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description: 'Только товары без категории',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  uncategorized?: boolean;
}
