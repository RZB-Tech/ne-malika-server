import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { WorkScheduleEntryDto } from './work-schedule-entry.dto';

export class PublicShopListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'TechnoDom' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Ключ логотипа в S3',
  })
  photo: string | null;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;

  @ApiProperty({ example: 'https://t.me/technodom_uz' })
  telegramLink: string;

  @ApiProperty({
    type: [WorkScheduleEntryDto],
    nullable: true,
    description: 'Часы работы; null — магазин их не заполнил',
  })
  workSchedule: WorkScheduleEntryDto[] | null;

  @ApiProperty({ example: 4.6, description: 'Средняя оценка, 0 — без отзывов' })
  ratingAvg: number;

  @ApiProperty({ example: 23 })
  ratingCount: number;

  @ApiProperty({
    example: 48,
    description: 'Сколько активных товаров в магазине сейчас',
  })
  productCount: number;

  @ApiProperty({ description: 'Когда магазин появился на площадке' })
  createdAt: string;
}

export class PaginatedPublicShopsDto {
  @ApiProperty({ type: [PublicShopListItemDto] })
  data: PublicShopListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class ShopSitemapEntryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ description: 'Дата последнего изменения магазина' })
  updatedAt: string;
}
