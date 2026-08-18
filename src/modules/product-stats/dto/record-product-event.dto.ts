import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

/** Что именно сделал посетитель на карточке. */
export const PRODUCT_EVENT_KINDS = ['view', 'phone', 'telegram'] as const;

export type ProductEventKind = (typeof PRODUCT_EVENT_KINDS)[number];

export class RecordProductEventDto {
  @ApiProperty({
    description:
      'view — открытие карточки, phone — раскрытие телефона, telegram — переход в чат',
    enum: PRODUCT_EVENT_KINDS,
    example: 'view',
  })
  @IsIn(PRODUCT_EVENT_KINDS)
  kind: ProductEventKind;

  /**
   * Анонимный идентификатор браузера из localStorage.
   *
   * Не кука: обычные запросы клиента идут без `credentials`, и серверная кука
   * до API просто не доехала бы — пришлось бы включать её глобально и трогать
   * авторизацию. localStorage тем же способом уже хранит историю просмотров
   * анонима до входа, так что механизм в проекте не новый.
   *
   * Значение подделываемо, и это принято сознательно: цена накрутки — испорченная
   * собственная статистика продавца, а не доступ к чужим данным. От случайного
   * шума защищают окно дедупликации и глобальный троттлер.
   */
  @ApiProperty({
    description: 'Анонимный id браузера (uuid из localStorage)',
    example: '9f1c3a54-7b2e-4c11-9a0d-2f5e8b6c1d33',
  })
  @IsString()
  @Length(8, 64)
  visitor_id: string;
}
