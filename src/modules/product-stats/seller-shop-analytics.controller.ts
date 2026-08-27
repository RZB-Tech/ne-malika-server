import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { SearchHitDto } from '../search-stats/dto/search-hit.dto';
import { ProductStatsService } from './product-stats.service';
import { StatsRangeQueryDto } from './dto/product-stats.dto';
import { SearchHitsQueryDto, ShopAnalyticsDto } from './dto/shop-analytics.dto';

const DEFAULT_DAYS = 30;

const DEFAULT_SEARCH_LIMIT = 20;

@ApiTags('shop-analytics-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/analytics')
export class SellerShopAnalyticsController {
  constructor(private readonly productStatsService: ProductStatsService) {}

  @Get()
  @ApiOperation({
    summary: 'Сводка по магазину: график, итоги, топ товаров',
    description:
      'Ряд по дням сплошной — сутки без событий приходят нулями. Глубина ограничена тарифом: 30 дней всем, 365 на MAX.',
  })
  @ApiResponse({ status: 200, type: ShopAnalyticsDto })
  @ApiResponse({
    status: 403,
    description: 'Период больше 30 дней доступен на тарифе MAX',
  })
  @ApiResponse({
    status: 404,
    description: 'У продавца нет активного магазина',
  })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StatsRangeQueryDto,
  ): Promise<ShopAnalyticsDto> {
    return this.productStatsService.forShop(
      user.id,
      query.days ?? DEFAULT_DAYS,
    );
  }

  @Get('searches')
  @ApiOperation({
    summary: 'По каким запросам находили товары магазина',
    description:
      'Только на тарифе MAX. Запросы нормализованы: нижний регистр, схлопнутые пробелы.',
  })
  @ApiResponse({ status: 200, type: [SearchHitDto] })
  @ApiResponse({
    status: 403,
    description: 'Статистика поисковых запросов доступна на тарифе MAX',
  })
  @ApiResponse({
    status: 404,
    description: 'У продавца нет активного магазина',
  })
  searches(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchHitsQueryDto,
  ): Promise<SearchHitDto[]> {
    return this.productStatsService.searchesForShop(
      user.id,
      query.days ?? DEFAULT_DAYS,
      query.limit ?? DEFAULT_SEARCH_LIMIT,
    );
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="nemalika-analytics.csv"',
  )
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Выгрузка аналитики магазина в CSV',
    description:
      'Только на тарифе MAX. Разделитель — точка с запятой, кодировка UTF-8 с BOM: файл открывается двойным щелчком в Excel с русской локалью.',
  })
  @ApiResponse({ status: 200, type: String })
  @ApiResponse({
    status: 403,
    description: 'Выгрузка CSV доступна на тарифе MAX',
  })
  @ApiResponse({
    status: 404,
    description: 'У продавца нет активного магазина',
  })
  export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StatsRangeQueryDto,
  ): Promise<string> {
    return this.productStatsService.exportCsvForShop(
      user.id,
      query.days ?? DEFAULT_DAYS,
    );
  }
}
