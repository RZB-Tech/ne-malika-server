import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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

/**
 * Ссылка баннера: либо абсолютный http(s), либо внутренний путь от корня.
 * Всё остальное — включая `javascript:` — до базы не доходит: значение
 * подставляется в href на витрине как есть.
 *
 * Пустая строка разрешена и означает «убрать ссылку»: `@IsOptional()`
 * пропускает только null и undefined, а форма правки шлёт очищенное поле
 * именно пустой строкой — без этого снять однажды заданную ссылку было нельзя.
 */
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
