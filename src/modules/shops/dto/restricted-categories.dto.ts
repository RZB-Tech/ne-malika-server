import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class RestrictedCategoriesDto {
  @ApiProperty({
    example: true,
    description:
      'Выдать (true) или отозвать (false) право выкладывать товары в закрытые ' +
      'разделы каталога — «Смартфоны» и «Планшеты»',
  })
  @IsBoolean()
  enabled: boolean;
}
