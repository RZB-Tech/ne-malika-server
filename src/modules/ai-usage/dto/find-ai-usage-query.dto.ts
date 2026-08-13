import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const AI_OPERATIONS = ['prompt', 'description', 'image'] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

export class FindAiUsageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Только по одному магазину' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shopId?: number;

  @ApiPropertyOptional({ description: 'Только по одному пользователю' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({ enum: AI_OPERATIONS, description: 'Вид операции' })
  @IsOptional()
  @IsIn(AI_OPERATIONS)
  operation?: AiOperation;
}
