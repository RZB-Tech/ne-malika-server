import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindProductCardsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Текстовый поиск по name/description',
    example: 'ноутбук',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ minimum: 0, example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_min?: number;

  @ApiPropertyOptional({ minimum: 0, example: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_max?: number;

  @ApiPropertyOptional({ enum: ['new', 'old'] })
  @IsOptional()
  @IsIn(['new', 'old'])
  state?: 'new' | 'old';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;

  @ApiPropertyOptional({
    enum: ['price_asc', 'price_desc', 'newest'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'newest';
}
