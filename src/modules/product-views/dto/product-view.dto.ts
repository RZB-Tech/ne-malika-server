import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { PublicProductSummaryDto } from '../../../common/dto/public-product-summary.dto';

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
