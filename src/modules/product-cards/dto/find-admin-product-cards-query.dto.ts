import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const ADMIN_PRODUCT_STATUSES = [
  'active',
  'hidden',
  'abolished',
  'pending',
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

  /**
   * Только товары без категории. Их не найти фильтром по разделу каталога:
   * такие карточки появляются, когда раздел удаляют (category_id → SET NULL)
   * или когда продавец завёл товар до появления справочника категорий.
   *
   * Разбираем строку вручную: @Type(() => Boolean) превратил бы 'false' в true,
   * потому что Boolean('false') — это true.
   */
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
