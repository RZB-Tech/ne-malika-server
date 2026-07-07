import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WorkScheduleEntryDto } from './work-schedule-entry.dto';

export class CreateShopDto {
  @ApiProperty({ minLength: 2, maxLength: 200, example: 'TechZone' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: 'Продаём ноутбуки и комплектующие с 2020 года',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  photo?: string;

  @ApiPropertyOptional({ example: 'https://t.me/techzone_support' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  telegramLink?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contact?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'г. Ташкент, ул. Амира Темура, 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ type: [WorkScheduleEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkScheduleEntryDto)
  workSchedule?: WorkScheduleEntryDto[];

  @ApiPropertyOptional({
    type: [Number],
    description: '[latitude, longitude]',
    example: [41.311081, 69.240562],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  location?: number[];
}
