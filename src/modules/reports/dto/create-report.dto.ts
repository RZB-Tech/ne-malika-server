import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({
    minLength: 5,
    example: 'Продавец не отвечает, товар не соответствует фото',
  })
  @IsString()
  @MinLength(5)
  context: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  shop_id: number;

  @ApiPropertyOptional({
    description: 'Если жалоба на конкретный товар',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_card_id?: number;
}
