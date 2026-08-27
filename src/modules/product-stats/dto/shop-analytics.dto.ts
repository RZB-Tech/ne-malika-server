/**
 * Аналитика магазина целиком: то же, что карточка показывает про один товар,
 * но поперёк всех.
 *
 * Отдельные классы, а не расширение `ProductStatsDto`: у магазина есть топ
 * товаров и границы периода, а у товара — «просмотры за 7 дней», и общий
 * предок оказался бы набором необязательных полей, про которые непонятно, кто
 * их заполняет.
 *
 * Запрошенной глубины в ответе нет отдельным числом — есть `from` и `to`.
 * Подпись под графиком клиент рисует по ним, а не по тому, что сам же
 * попросил: если сервер когда-нибудь урежет период, подпись останется правдой.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { StatsRangeQueryDto } from './product-stats.dto';

/** Сутки магазина: те же пять счётчиков, что и у товара. */
export class ShopDailyPointDto {
  @ApiProperty({ description: 'Сутки, YYYY-MM-DD', example: '2026-08-18' })
  date: string;

  @ApiProperty({
    description: 'Просмотров карточек за эти сутки',
    example: 312,
  })
  views: number;

  @ApiProperty({
    description: 'Посетителей за эти сутки — сумма уникальных по товарам',
    example: 204,
  })
  visitors: number;

  @ApiProperty({ description: 'Раскрытий телефона за эти сутки', example: 18 })
  phoneClicks: number;

  @ApiProperty({
    description: 'Переходов в Telegram за эти сутки',
    example: 26,
  })
  telegramClicks: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 33,
  })
  contactVisitors: number;
}

/** Строка топа товаров: чем интересовались и чем это кончилось. */
export class TopProductDto {
  @ApiProperty({ description: 'Идентификатор товара', example: 4821 })
  id: number;

  @ApiProperty({ description: 'Название товара', example: 'Ноутбук ASUS X515' })
  name: string;

  @ApiProperty({ description: 'Просмотры за период', example: 512 })
  views: number;

  @ApiProperty({
    description: 'Посещения за период — сумма уникальных по дням',
    example: 340,
  })
  visits: number;

  @ApiProperty({
    description: 'Контакты: раскрытия телефона плюс переходы в Telegram',
    example: 47,
  })
  contacts: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 38,
  })
  contactVisitors: number;

  @ApiProperty({
    description: 'Доля дошедших до контакта, целых процентов от 0 до 100',
    example: 11,
  })
  conversionPercent: number;
}

export class ShopAnalyticsDto {
  @ApiProperty({ description: 'Идентификатор магазина', example: 42 })
  shopId: number;

  /** Нужно и странице, и шапке CSV: файл без имени магазина через месяц никому ничего не скажет. */
  @ApiProperty({
    description: 'Название магазина',
    example: 'Малика Электроникс',
  })
  shopName: string;

  @ApiProperty({
    description: 'Первые сутки периода, YYYY-MM-DD',
    example: '2026-07-20',
  })
  from: string;

  @ApiProperty({
    description: 'Последние сутки периода, YYYY-MM-DD',
    example: '2026-08-18',
  })
  to: string;

  @ApiProperty({ description: 'Просмотры за период', example: 9312 })
  views: number;

  /**
   * Сумма уникальных по дням и по товарам, а не уникальные за период: один
   * человек, заходивший трижды в разные дни, посчитан трижды, а открывший три
   * карточки — ещё трижды. Разбор — в докблоке `shopDaily`. Названо
   * «посещениями», как и у карточки товара, чтобы не выдавать одно за другое.
   */
  @ApiProperty({
    description: 'Посещений за период — сумма уникальных по дням и товарам',
    example: 6104,
  })
  visits: number;

  @ApiProperty({ description: 'Раскрытий телефона за период', example: 402 })
  phoneClicks: number;

  @ApiProperty({ description: 'Переходов в Telegram за период', example: 611 })
  telegramClicks: number;

  @ApiProperty({
    description: 'Контакты: раскрытия телефона плюс переходы в Telegram',
    example: 1013,
  })
  contacts: number;

  @ApiProperty({
    description: 'Посетителей, дошедших до контакта — без двойного счёта',
    example: 780,
  })
  contactVisitors: number;

  /**
   * Считается от `contactVisitors`, а не от `contacts`: один посетитель умеет
   * и раскрыть телефон, и уйти в Telegram, так что сумма контактов способна
   * обогнать число посетителей и выдать «конверсию 140%». Ровно этим же
   * способом считает карточка товара на клиенте.
   */
  @ApiProperty({
    description: 'Доля дошедших до контакта, целых процентов от 0 до 100',
    example: 12,
  })
  conversionPercent: number;

  @ApiProperty({
    description: 'Ряд по дням от старого к новому, без пропусков',
    type: [ShopDailyPointDto],
  })
  daily: ShopDailyPointDto[];

  @ApiProperty({
    description: 'Самые просматриваемые товары периода',
    type: [TopProductDto],
  })
  topProducts: TopProductDto[];
}

/**
 * Глубина и длина отчёта по поисковым запросам.
 *
 * Наследует `days` у `StatsRangeQueryDto` вместо того, чтобы объявить его
 * заново: правило «не больше 365 суток» — одно на всю аналитику, и второй
 * `@Max` рано или поздно разъехался бы с первым.
 *
 * Самого `SearchHitDto` здесь нет намеренно: строку отчёта объявляет тот, кто
 * её считает, — `src/modules/search-stats/dto/search-hit.dto.ts`. Второй класс
 * с тем же именем дал бы две одноимённые схемы в OpenAPI, а из двух схем с
 * одним именем в документ попадает одна, и какая именно — вопрос порядка
 * обхода контроллеров.
 */
export class SearchHitsQueryDto extends StatsRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Сколько запросов вернуть',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
