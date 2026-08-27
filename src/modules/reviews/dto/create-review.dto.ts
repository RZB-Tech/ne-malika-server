import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const REVIEW_TEXT_MAX = 2000;

export class CreateReviewDto {
  @ApiPropertyOptional({
    example: 10,
    description: 'Отзыв о товаре. Магазин определяется по товару сам.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productCardId?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Отзыв о магазине целиком. Указывается вместо товара.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shopId?: number;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    maxLength: REVIEW_TEXT_MAX,
    example: 'Забрал в день заказа, продавец всё показал и проверил.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(REVIEW_TEXT_MAX)
  text?: string;
}
