import { ApiProperty } from '@nestjs/swagger';

/**
 * Строка отчёта «по каким запросам вас находят».
 *
 * Отдаётся продавцу на тарифе MAX; гейт стоит в контроллере аналитики, а не
 * здесь — DTO описывает форму данных, а не право их увидеть.
 */
export class SearchHitDto {
  @ApiProperty({
    description: 'Нормализованный запрос: нижний регистр, одиночные пробелы',
    example: 'ноутбук asus',
    maxLength: 100,
  })
  query: string;

  @ApiProperty({
    description:
      'Сколько раз по этому запросу в выдаче оказался товар магазина за период',
    example: 37,
  })
  shows: number;
}
