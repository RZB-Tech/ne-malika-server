import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BANNER_FORMATS_LABEL } from '../banners.constants';

const PHOTO_DESCRIPTION =
  `Ключ загруженного файла (POST /seller/uploads). ` +
  `Допустимое разрешение — ${BANNER_FORMATS_LABEL} ` +
  `или кратно больше с тем же соотношением сторон.`;

const LINK_PATTERN = /^(|https?:\/\/[^\s]+|\/[^\s]*)$/;

export class CreateBannerDto {
  @ApiProperty({
    minLength: 2,
    maxLength: 200,
    example: 'Школьный базар — выгода до 50%',
    description: 'Название для админки; оно же alt изображения',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiProperty({ format: 'uuid', description: `${PHOTO_DESCRIPTION} Русская.` })
  @IsUUID('4')
  photoRu: string;

  @ApiProperty({
    format: 'uuid',
    description: `${PHOTO_DESCRIPTION} Узбекская латиница.`,
  })
  @IsUUID('4')
  photoUzLatn: string;

  @ApiProperty({
    format: 'uuid',
    description: `${PHOTO_DESCRIPTION} Узбекская кириллица.`,
  })
  @IsUUID('4')
  photoUzCyrl: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: '/product/12',
    description:
      'Куда ведёт клик: абсолютный https-адрес или путь от корня сайта. ' +
      'Пусто — баннер показывается, но не кликается',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(LINK_PATTERN, {
    message: 'linkUrl должен быть http(s)-адресом или путём, начинающимся с /',
  })
  linkUrl?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Выключенный баннер остаётся в админке, но не показывается',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 12,
    description:
      'Кому принадлежит баннер: id магазина — баннер выдан магазину и ' +
      'показывается по правилам баннеров магазинов, пусто — баннер площадки',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  shopId?: number | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-01T00:00:00.000Z',
    description:
      'Когда баннер сам скроется с витрины. Пусто — показывается бессрочно. ' +
      'Прошедшая дата скрывает баннер сразу, из админки он не исчезает',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    description: 'Порядок в карусели: меньше — раньше',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
