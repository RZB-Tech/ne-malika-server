import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AbolishProductCardDto {
  @ApiProperty({
    minLength: 5,
    description: 'Причина упразднения — видна продавцу',
    example: 'Товар не соответствует описанию',
  })
  @IsString()
  @MinLength(5)
  reason: string;
}
