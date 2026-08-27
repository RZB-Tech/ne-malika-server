import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class ReorderBannersDto {
  @ApiProperty({
    type: [Number],
    example: [3, 1, 2],
    description: 'id баннеров в желаемом порядке показа',
  })
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  ids: number[];
}
