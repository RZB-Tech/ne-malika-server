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
 * Три разрешения в трёх форматах. gpt-image-2 принимает произвольный размер,
 * но в рамках ограничений: сторона не больше 3840, обе кратны 16, отношение
 * сторон не круче 3:1, а всего пикселей от 655 360 до 8 294 400.
 *
 * Поэтому «4K» здесь — это максимум, который влезает в лимит пикселей:
 * 2880×2880 для квадрата и 3840×2160 для горизонтали (ровно 8 294 400).
 * Список фиксированный: свободное поле означало бы 400 от модели на каждой
 * опечатке в размере.
 */
export const IMAGE_SIZES = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '2048x2048',
  '1728x2560',
  '2560x1728',
  '2880x2880',
  '2160x3840',
  '3840x2160',
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
