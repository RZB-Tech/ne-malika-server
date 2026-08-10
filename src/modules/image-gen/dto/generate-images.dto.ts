import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

/**
 * Размеры только в пикселях. Тиры вроде «1K» в документации OpenRouter описаны,
 * но gpt-image-2 их отвергает: «Invalid size '1K'. Expected WIDTHxHEIGHT».
 *
 * Значения не произвольные — модель требует, чтобы обе стороны были кратны 16,
 * а всего пикселей было не больше 8 294 400. В этот потолок 2880x2880 упирается
 * ровно, поэтому он и есть максимум для квадрата.
 */
export const IMAGE_SIZES = [
  '1024x1024',
  '2048x2048',
  '2560x2560',
  '2880x2880',
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const MAX_GENERATED_IMAGES = 4;

export class GenerateImagesDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Фото товара, которое берём за основу — его же и перерисуем',
  })
  @IsUUID('4')
  photoKey: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Необязательный референс: вторая картинка, на которую надо ориентироваться',
  })
  @IsOptional()
  @IsUUID('4')
  referenceKey?: string;

  @ApiProperty({
    minLength: 3,
    maxLength: 2000,
    example: 'Ноутбук на светлом фоне, студийный свет, вид три четверти',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  prompt: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_GENERATED_IMAGES,
    default: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_GENERATED_IMAGES)
  count?: number;

  @ApiPropertyOptional({ enum: IMAGE_QUALITIES, default: 'medium' })
  @IsOptional()
  @IsIn(IMAGE_QUALITIES)
  quality?: ImageQuality;

  @ApiPropertyOptional({ enum: IMAGE_SIZES, default: '1024x1024' })
  @IsOptional()
  @IsIn(IMAGE_SIZES)
  size?: ImageSize;
}

export class DescribePromptDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Фото, по которому писать промпт',
  })
  @IsUUID('4')
  photoKey: string;
}

export class GeneratedImageDto {
  @ApiProperty({ format: 'uuid' })
  key: string;

  @ApiProperty()
  url: string;
}
