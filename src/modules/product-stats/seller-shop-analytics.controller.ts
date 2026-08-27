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

/** Глубина периода по умолчанию — та же, что у статистики отдельного товара. */
const DEFAULT_DAYS = 30;

/** Длина отчёта по запросам по умолчанию. */
const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Аналитика магазина в кабинете продавца.
 *
 * Идентификатора магазина ни в одном пути нет: магазин у продавца один и
 * выводится по владельцу токена. Отсюда же и отсутствие проверок владения в
 * контроллере — проверять нечего, чужой магазин сюда просто неоткуда взяться.
 *
 * Три ручки, а не одна с флагами: у них разные права (сводку видят все, запросы
 * и выгрузку — только MAX) и разные форматы ответа. Гейты стоят в сервисе, а не
 * здесь: тариф читается из строки магазина, которую всё равно достаёт сервис,
 * и вынесенная в декоратор проверка означала бы второй поход в базу за тем же.
 */
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

  /**
   * Выгрузка той же сводки файлом. Только на тарифе MAX.
   *
   * `Content-Disposition` с постоянным именем, а не с датой в имени: имя файла
   * всё равно назначает клиент при сохранении блоба (`downloadAnalyticsCsv`),
   * а заголовок нужен ровно затем, чтобы браузер, если ручку открыли ссылкой
   * напрямую, предложил сохранить файл, а не показал таблицу текстом.
   *
   * Расширение прямо в пути (`export.csv`) — для человека: по такой ссылке в
   * журнале nginx или в отладчике браузера видно, что вернётся файл, а не
   * очередной JSON. Спутать её ни с чем нельзя — маршрутов с параметром в этом
   * контроллере нет вовсе, а Nest сравнивает сегмент целиком.
   */
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
