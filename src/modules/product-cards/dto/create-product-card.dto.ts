import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CharacteristicDto } from 'src/modules/shops/dto/characteristics';

export class CreateProductCardDto {
  @ApiProperty({ minLength: 2, maxLength: 200, example: 'MacBook Air M2 13"' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Состояние отличное, гарантия до 2027 года' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  photos: string[];

  @ApiProperty({ minimum: 0, example: 899.99 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ enum: ['new', 'old'], example: 'new' })
  @IsIn(['new', 'old'])
  state: 'new' | 'old';

  @ApiPropertyOptional({
    type: [CharacteristicDto],
    description: 'Произвольные характеристики товара (ключ-значение)',
    example: [
      { key: 'Процессор', value: 'Apple M2' },
      { key: 'ОЗУ', value: '8 ГБ' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CharacteristicDto)
  characteristics?: CharacteristicDto[];
}
