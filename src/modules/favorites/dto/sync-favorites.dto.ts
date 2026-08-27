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

export class SyncFavoriteItemDto {
  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_card_id: number;

  @ApiProperty({
    description: 'Когда товар добавили в избранное на устройстве, ISO-8601',
    example: '2026-07-30T14:05:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  added_at?: string;
}

export class SyncFavoritesDto {
  @ApiProperty({
    type: [SyncFavoriteItemDto],
    description: 'Локальное избранное устройства; лишнее клиент отсекает сам',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SyncFavoriteItemDto)
  items: SyncFavoriteItemDto[];
}
