import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const AI_OPERATIONS = [
  'prompt',
  'description',
  'image',
  'autofill',
] as const;
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

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description:
      'true — только бесплатные по подписке, false — только те, за которые ' +
      'списаны кредиты. Запросы администратора не бесплатные: у них нет ' +
      'магазина, ищите их по shopId',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  free?: boolean;
}
