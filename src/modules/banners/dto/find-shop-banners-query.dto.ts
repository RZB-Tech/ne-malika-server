import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  BANNER_MODERATION_STATUSES,
  type BannerModerationStatus,
} from '../banners.constants';

export class FindShopBannersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BANNER_MODERATION_STATUSES,
    example: 'pending',
    description: 'Фильтр по состоянию модерации',
  })
  @IsOptional()
  @IsIn(BANNER_MODERATION_STATUSES)
  status?: BannerModerationStatus;

  @ApiPropertyOptional({ example: 12, description: 'Только баннеры магазина' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shop_id?: number;
}
