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

/**
 * Решение администратора по баннеру продавца.
 *
 * Одна ручка на оба исхода, а не `approve` и `reject` раздельно: решение
 * принимается в одном месте интерфейса одним движением, и разделение на два
 * пути означало бы два одинаковых обработчика, отличающихся строкой статуса.
 *
 * Причина объявлена необязательной, хотя при отказе она обязательна: это
 * зависимость одного поля от другого, и выразить её декоратором можно только
 * `@ValidateIf`, который в спеке не виден вовсе — клиент увидел бы «reason
 * можно не слать» и узнал бы правду от 400. Поэтому проверка живёт в сервисе
 * рядом с текстом ошибки: «Укажите причину отказа».
 */
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
