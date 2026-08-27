import { ApiProperty } from '@nestjs/swagger';

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
