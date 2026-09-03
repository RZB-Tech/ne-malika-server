import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AI_OPERATIONS, type AiOperation } from '../../../db/schema';

export { AI_OPERATIONS, type AiOperation };

export const AI_USAGE_PERIODS = ['all', 'today', '7d', '30d'] as const;
export type AiUsagePeriod = (typeof AI_USAGE_PERIODS)[number];

export const AI_USAGE_SORTS = [
  'newest',
  'oldest',
  'cost_desc',
  'cost_asc',
  'credits_desc',
] as const;
export type AiUsageSort = (typeof AI_USAGE_SORTS)[number];

export class FindAiUsageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Поисковый запрос (пользователь, @username, магазин, модель)',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Модель нейросети' })
  @IsOptional()
  @IsString()
  model?: string;

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

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description:
      'true — только бесплатные по подписке, false — только те, за которые списаны кредиты.',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  free?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description: 'true — только расходы платформы (без привязки к магазину)',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  platform?: boolean;

  @ApiPropertyOptional({
    enum: AI_USAGE_PERIODS,
    description: 'Быстрый фильтр периода',
  })
  @IsOptional()
  @IsIn(AI_USAGE_PERIODS)
  period?: AiUsagePeriod;

  @ApiPropertyOptional({ description: 'Начальная дата периода, YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Конечная дата периода, YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ enum: AI_USAGE_SORTS, description: 'Сортировка' })
  @IsOptional()
  @IsIn(AI_USAGE_SORTS)
  sort?: AiUsageSort;
}
