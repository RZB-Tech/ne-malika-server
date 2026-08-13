import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Разрешение магазину на закрытые разделы каталога.
 *
 * Одним полем со значением, а не парой ручек grant/revoke: администратор в
 * списке магазинов видит переключатель и ставит его в нужное положение — при
 * двух ручках клиенту пришлось бы гадать, какую из них дёрнуть.
 */
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
