import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class SyncProductViewItemDto {
  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_card_id: number;

  @ApiProperty({
    description: 'Когда товар смотрели на устройстве, ISO-8601',
    example: '2026-07-30T14:05:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  viewed_at?: string;
}

export class SyncProductViewsDto {
  @ApiProperty({
    type: [SyncProductViewItemDto],
    description: 'Локальная история устройства; лишнее клиент отсекает сам',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncProductViewItemDto)
  items: SyncProductViewItemDto[];
}
