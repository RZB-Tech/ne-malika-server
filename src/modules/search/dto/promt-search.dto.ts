import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PromptSearchDto extends PaginationQueryDto {
  @ApiProperty({
    minLength: 2,
    maxLength: 500,
    example: 'что-то тихое для офиса до 800 долларов',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  prompt: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_min?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_max?: number;

  @ApiPropertyOptional({ enum: ['new', 'old'] })
  @IsOptional()
  @IsIn(['new', 'old'])
  state?: 'new' | 'old';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;

  @ApiPropertyOptional({ enum: ['price_asc', 'price_desc', 'newest'] })
  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'newest';
}
