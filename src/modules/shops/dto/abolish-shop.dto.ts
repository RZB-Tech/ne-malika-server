import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AbolishShopDto {
  @ApiProperty({
    minLength: 5,
    description: 'Причина упразднения — видна продавцу',
    example: 'Множественные жалобы на мошенничество',
  })
  @IsString()
  @MinLength(5)
  reason: string;
}
