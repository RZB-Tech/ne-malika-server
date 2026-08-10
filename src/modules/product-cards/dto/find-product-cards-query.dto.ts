import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
    description:
      'Выбрать конкретные товары по id, через запятую (?ids=10,12,15). ' +
      'Нужен таблице сравнения: список товаров она держит у себя и тянет их одним запросом.',
    example: '10,12,15',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    String(value)
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0),
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  ids?: number[];

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

  /**
   * Фильтр по ветке каталога: указав корень, покупатель получает и товары из
   * его подкатегорий — иначе «Ноутбуки» отдавали бы пустую выдачу, ведь товары
   * лежат в листьях.
   */
  @ApiPropertyOptional({
    example: 12,
    description: 'id категории; товары подкатегорий тоже попадут в выдачу',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({
    example: 'laptops',
    description: 'slug категории верхнего уровня — альтернатива category_id',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    enum: ['price_asc', 'price_desc', 'newest'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'newest';
}
