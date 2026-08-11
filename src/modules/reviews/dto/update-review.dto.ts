import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REVIEW_TEXT_MAX } from './create-review.dto';

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5, example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: REVIEW_TEXT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(REVIEW_TEXT_MAX)
  text?: string;
}
