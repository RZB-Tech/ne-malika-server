import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { PublicProductSummaryDto } from '../../../common/dto/public-product-summary.dto';

export class FavoriteDto extends PublicProductSummaryDto {
  @ApiProperty({ description: 'Когда товар добавили в избранное' })
  addedAt: string;
}

export class PaginatedFavoritesDto {
  @ApiProperty({ type: [FavoriteDto] })
  data: FavoriteDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
