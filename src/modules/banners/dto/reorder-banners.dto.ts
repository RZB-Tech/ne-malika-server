import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

/**
 * Новый порядок карусели одним запросом. Отдельный эндпоинт, а не пачка PATCH
 * по одному баннеру: перестановка соседей меняет позицию сразу у двоих, и два
 * независимых запроса успевают оставить список с дублем порядка, если второй
 * не дойдёт.
 */
export class ReorderBannersDto {
  @ApiProperty({
    type: [Number],
    example: [3, 1, 2],
    description: 'id баннеров в желаемом порядке показа',
  })
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  ids: number[];
}
