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

  /**
   * Покупателю закрытый раздел виден как любой другой — флаг нужен форме товара,
   * чтобы показать продавцу без разрешения, что раздел есть, но выбрать его
   * нельзя.
   */
  @ApiProperty({
    example: false,
    description:
      'Закрытый раздел: выложить товар может лишь магазин с разрешением от ' +
      'администратора. У подкатегорий повторяет значение корня.',
  })
  restricted: boolean;

  @ApiProperty({ type: [CategoryDto], description: 'Подкатегории' })
  children: CategoryDto[];
}
