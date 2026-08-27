import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  BANNER_MODERATION_STATUSES,
  type BannerModerationStatus,
} from '../banners.constants';

/**
 * Очередь модерации баннеров.
 *
 * С листалкой, в отличие от `GET /admin/banners`: площадочных баннеров десяток
 * и они помещаются в один экран, а заявок от продавцов будет столько же,
 * сколько подписчиков MAX, и растёт это число само.
 *
 * `shop_id` в змеином регистре — как во всей остальной выдаче
 * (`FindProductCardsQueryDto.shop_id`): параметры строки запроса в этом
 * проекте пишутся так, и одно исключение стоило бы дороже единообразия.
 */
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
