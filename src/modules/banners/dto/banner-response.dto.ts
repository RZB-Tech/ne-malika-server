import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import {
  BANNER_MODERATION_STATUSES,
  type BannerModerationStatus,
} from '../banners.constants';
import { PublicBannerDto } from './public-banner.dto';

export class BannerDto extends PublicBannerDto {
  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  shopId: number | null;

  @ApiProperty({ enum: BANNER_MODERATION_STATUSES, example: 'pending' })
  status: BannerModerationStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Текст акции обрезан по правому краю',
  })
  rejectReason: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  moderatedAt: Date | null;

  @ApiPropertyOptional({ format: 'date-time' })
  createdAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  updatedAt?: string;
}

export class AdminBannerDto extends BannerDto {
  @ApiProperty({ example: 'ТехноМаркет' })
  shopName: string;
}

export class PaginatedShopBannersDto {
  @ApiProperty({ type: [AdminBannerDto] })
  data: AdminBannerDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
