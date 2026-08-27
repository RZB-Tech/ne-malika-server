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

export const CARD_STYLES = ['infographic', 'photo'] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const IMAGE_SIZES = [
  '960x1280',
  '1440x1920',
  '1728x2304',
  '2448x3264',
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
      'Необязательный референс: вторая картинка, оформление которой надо повторить',
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

  @ApiPropertyOptional({ enum: CARD_STYLES, default: 'infographic' })
  @IsOptional()
  @IsIn(CARD_STYLES)
  style?: CardStyle;

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

  @ApiPropertyOptional({ enum: IMAGE_SIZES, default: '960x1280' })
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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Референс оформления: если он есть, промпт описывает товар в его вёрстке',
  })
  @IsOptional()
  @IsUUID('4')
  referenceKey?: string;

  @ApiPropertyOptional({ enum: CARD_STYLES, default: 'infographic' })
  @IsOptional()
  @IsIn(CARD_STYLES)
  style?: CardStyle;
}

export const DESCRIPTION_MAX = 2000;

export class RewriteDescriptionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Фото товара: по нему модель сверяет написанное',
  })
  @IsUUID('4')
  photoKey: string;

  @ApiProperty({
    maxLength: DESCRIPTION_MAX,
    description:
      'Текст продавца. Пустой допустим — тогда описание пишется по одной фотографии',
    example: 'клавиатура механическа RGB подсветка беспроводная',
  })
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  text: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Название товара. Модель его не переписывает, но опирается на него',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class RewrittenDescriptionDto {
  @ApiProperty({ description: 'Исправленное описание' })
  text: string;
}

export class GeneratedImageDto {
  @ApiProperty({ format: 'uuid' })
  key: string;

  @ApiProperty()
  url: string;
}

export class ImageGenBalanceDto {
  @ApiProperty({ description: 'Разрешена ли генерация: у админа — всегда' })
  allowed: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Остаток кредитов. null — без ограничения (администратор)',
    example: 8400,
  })
  credits: number | null;
}

export class StoredImageDto {
  @ApiProperty({ format: 'uuid' })
  key: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  prompt: string;

  @ApiProperty()
  createdAt: string;
}
