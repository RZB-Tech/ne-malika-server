import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { ProductStatsService } from './product-stats.service';
import { ProductStatsDto, StatsRangeQueryDto } from './dto/product-stats.dto';

/**
 * Статистика карточки в кабинете продавца.
 *
 * Владение проверяется через `getOwnOrThrow`, а не по переданному магазину:
 * иначе продавец, подставив чужой id товара со своим shopId, увидел бы
 * чужие цифры.
 */
@ApiTags('product-stats-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller')
export class SellerProductStatsController {
  constructor(private readonly productStatsService: ProductStatsService) {}

  @Get('product-cards/:id/stats')
  @ApiOperation({ summary: 'Просмотры и контакты по своей карточке' })
  @ApiResponse({ status: 200, type: ProductStatsDto })
  @ApiResponse({ status: 404, description: 'Товар не найден или чужой' })
  stats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StatsRangeQueryDto,
  ): Promise<ProductStatsDto> {
    return this.productStatsService.forSeller(user.id, id, query.days ?? 30);
  }
}
