import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { PublicProductSummaryDto } from '../../../common/dto/public-product-summary.dto';

/**
 * Просмотренный товар в кабинете покупателя: публичная проекция карточки плюс
 * когда и сколько раз её открывали. Описан классом (а не сырым объектом, как
 * ранние эндпоинты) — иначе orval на клиенте сгенерировал бы `unknown`.
 */
export class ProductViewDto extends PublicProductSummaryDto {
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
