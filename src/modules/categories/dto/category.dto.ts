import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Названия отдаём тремя полями, а не одним по заголовку Accept-Language:
 * клиент кэширует дерево целиком и переключает язык без похода на сервер.
 */
export class CategoryNameDto {
  @ApiProperty({ example: 'Ноутбуки' })
  ru: string;

  @ApiProperty({ example: 'Noutbuklar' })
  'uz-Latn': string;

  @ApiProperty({ example: 'Ноутбуклар' })
  'uz-Cyrl': string;
}

export class CategoryDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'laptops' })
  slug: string;

  @ApiProperty({ type: CategoryNameDto })
  name: CategoryNameDto;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Laptop',
    description: 'Имя иконки lucide, есть только у категорий верхнего уровня',
  })
  icon?: string | null;

  @ApiProperty({ type: [CategoryDto], description: 'Подкатегории' })
  children: CategoryDto[];
}
