import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Причина модераторского действия — упразднения товара или магазина,
 * блокировки продавца. Во всех трёх случаях требования одинаковые,
 * а раньше это был один и тот же класс, скопированный трижды.
 */
export class ReasonDto {
  @ApiProperty({
    minLength: 5,
    description: 'Причина — видна продавцу',
    example: 'Множественные жалобы на мошенничество',
  })
  @IsString()
  @MinLength(5)
  reason: string;
}
