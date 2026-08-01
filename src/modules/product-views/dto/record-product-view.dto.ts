import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class RecordProductViewDto {
  @ApiProperty({ description: 'Товар, карточку которого открыли', example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_card_id: number;
}
