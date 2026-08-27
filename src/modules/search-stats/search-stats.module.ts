import { Module } from '@nestjs/common';
import { SearchStatsRepository } from './search-stats.repository';
import { SearchStatsService } from './search-stats.service';

/**
 * Счётчик поисковых запросов. Контроллеров у модуля нет намеренно: пишет в него
 * каталог (`ProductCardsService` — там уже собрана выдача, и второй такой же
 * запрос ради статистики стоил бы столько же, сколько сам поиск), а читает
 * аналитика продавца. Отдельная публичная ручка «запиши запрос» означала бы
 * счётчик, который любой желающий накручивает curl'ом без всякого поиска.
 *
 * `RedisModule` не импортируется: он объявлен `@Global` (см.
 * `ProductStatsModule`, где на это уже опираются). Импортов нет вовсе — модуль
 * зависит только от соединения с базой, и это делает его безопасным для
 * импорта откуда угодно, включая сам каталог.
 */
@Module({
  providers: [SearchStatsRepository, SearchStatsService],
  exports: [SearchStatsService],
})
export class SearchStatsModule {}
