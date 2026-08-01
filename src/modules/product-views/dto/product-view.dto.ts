import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';

/**
 * Просмотренный товар в кабинете покупателя: публичная проекция карточки плюс
 * когда и сколько раз её открывали. Описан классом (а не сырым объектом, как
 * ранние эндпоинты) — иначе orval на клиенте сгенерировал бы `unknown`.
 */
export class ProductViewDto {
  @ApiProperty({ description: 'Идентификатор товара', example: 10 })
  id: number;

  @ApiProperty({ example: 1 })
  shopId: number;

  @ApiProperty({ example: 'TechnoDom' })
  shopName: string;

  @ApiProperty({ example: 'Ноутбук Lenovo IdeaPad 3' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: [String], description: 'Ключи файлов в S3' })
  photos: string[];

  @ApiProperty({
    example: '5400000.00',
    description: 'numeric приходит строкой',
  })
  price: string;

  @ApiProperty({ enum: ['new', 'old'] })
  state: 'new' | 'old';

  @ApiProperty({ description: 'Последний просмотр' })
  viewedAt: string;

  @ApiProperty({ description: 'Сколько раз открывали карточку', example: 3 })
  viewCount: number;
}

export class PaginatedProductViewsDto {
  @ApiProperty({ type: [ProductViewDto] })
  data: ProductViewDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
