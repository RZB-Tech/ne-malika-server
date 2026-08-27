import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  BANNER_MODERATION_DECISIONS,
  type BannerModerationDecision,
} from '../banners.constants';

export class ModerateBannerDto {
  @ApiProperty({
    enum: BANNER_MODERATION_DECISIONS,
    example: 'approved',
    description:
      'Решение: approved — баннер уходит в карусель, rejected — возвращается ' +
      'продавцу с причиной',
  })
  @IsIn(BANNER_MODERATION_DECISIONS)
  status: BannerModerationDecision;

  @ApiPropertyOptional({
    minLength: 5,
    maxLength: 1000,
    example: 'Текст акции обрезан по правому краю',
    description:
      'Причина отказа — её читает продавец. Обязательна при status = rejected',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason?: string;
}
