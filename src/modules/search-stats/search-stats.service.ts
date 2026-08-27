import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { isBot, shiftDay, today } from '../product-stats/product-stats.util';
import { SearchStatsRepository } from './search-stats.repository';
import {
  SEARCH_DEDUP_WINDOW_SEC,
  normalizeSearchQuery,
} from './search-stats.util';
import type { SearchHitDto } from './dto/search-hit.dto';

/**
 * По каким словам покупатели находят товары магазина.
 *
 * Счётчик, а не журнал: каждый поиск сворачивается в строку «магазин + сутки +
 * запрос», как это делает `product_stats_daily` с просмотрами. Сырой журнал
 * поисков рос бы неограниченно и всё равно требовал бы свёртки ради отчёта.
 */
@Injectable()
export class SearchStatsService {
  private readonly logger = new Logger(SearchStatsService.name);

  constructor(
    private readonly repository: SearchStatsRepository,
    private readonly redis: RedisService,
  ) {}

  /**
   * Записать, что по запросу показались товары каких-то магазинов.
   *
   * **Ничего не возвращает и ничего не ждёт.** Вызывающий поиск уже собран и
   * вот-вот уйдёт покупателю: заставить его дожидаться счётчика значило бы
   * добавить к каждому нажатию клавиши обращение в Redis и две — в базу, а
   * уронить поиск из-за сбоя счётчика — наказать покупателя за нашу
   * статистику. Тот же приём и по той же причине применён в
   * `AiUsageService.record`, где журнал не имеет права уронить оплаченную
   * генерацию.
   *
   * Список магазинов приходит функцией, а не значением, и это не украшение:
   * достаётся он отдельным запросом по всей выдаче (см. `findMatchingShopIds`),
   * и выполнять его до проверок — значит платить полным сканом за каждую букву,
   * набранную в шапке. Функция вызывается последней, когда уже известно, что
   * записать есть что: запрос не короткий, посетитель не робот, и за последние
   * десять минут он этого не искал.
   *
   * Порядок проверок — от дешёвых к дорогим, и дедупликация стоит перед
   * запросом магазинов намеренно. Плата за это — сгоревшее окно дедупликации,
   * если запись потом не удалась: показ пропадёт, а повтор в ближайшие десять
   * минут его не восстановит. Обратный порядок (сначала записать, потом занять
   * ключ) стоил бы дороже: два одновременных запроса от одного посетителя оба
   * прошли бы проверку и оба записались.
   *
   * `visitorId` обязателен по смыслу, хотя и приходит необязательным полем: без
   * подписи посетителя дедуплицировать не по чему, а недедуплицированный
   * счётчик показывает не «что ищут», а «кто чаще жмёт F5». Дедуп по адресу
   * (`req.ip`) невозможен: `app.set('trust proxy')` не выставлен, за nginx
   * адрес одинаков у всех, и на всю площадку записывался бы один показ в
   * десять минут.
   */
  record(
    rawQuery: string,
    visitorId: string | undefined,
    userAgent: string | undefined,
    resolveShopIds: () => Promise<number[]>,
  ): void {
    void this.write(rawQuery, visitorId, userAgent, resolveShopIds);
  }

  private async write(
    rawQuery: string,
    visitorId: string | undefined,
    userAgent: string | undefined,
    resolveShopIds: () => Promise<number[]>,
  ): Promise<void> {
    try {
      if (visitorId === undefined || isBot(userAgent)) return;

      const query = normalizeSearchQuery(rawQuery);
      if (query === null) return;

      if (
        !(await this.redis.claim(
          this.dedupKey(visitorId, query),
          SEARCH_DEDUP_WINDOW_SEC,
        ))
      ) {
        return;
      }

      const shopIds = await resolveShopIds();
      if (shopIds.length === 0) return;

      await this.repository.record(shopIds, today(), query);
    } catch (err) {
      this.logger.error(
        `Не удалось записать поисковый запрос: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Ключ дедупликации. Запрос идёт в него хэшем, а не текстом: покупатель
   * набирает что угодно, включая пробелы, двоеточия и переводы строки, а ключ
   * Redis такой строкой становится нечитаемым в `SCAN` и рискует столкнуться с
   * чужим пространством имён. Sha-1 здесь не про безопасность, а про
   * фиксированную длину — подбирать коллизию к чужому поисковому запросу
   * бессмысленно.
   */
  private dedupKey(visitorId: string, query: string): string {
    const digest = createHash('sha1')
      .update(`${visitorId}|${query}`)
      .digest('hex')
      .slice(0, 20);

    return `srch:${digest}`;
  }

  /**
   * Топ запросов магазина за период — отчёт продавца на тарифе MAX.
   *
   * Право смотреть проверяет контроллер аналитики через `effectiveLimits`:
   * сервис получает уже разрешённый `shopId` и не знает, чей он, — ровно так же
   * устроен `ProductStatsService.forSeller`, где владение проверяется до
   * обращения к цифрам.
   */
  topForShop(
    shopId: number,
    from: string,
    to: string,
    limit: number,
  ): Promise<SearchHitDto[]> {
    return this.repository.topForShop(shopId, from, to, limit);
  }

  /**
   * Ретенция: убрать сутки старше `days`. Зовётся ночным заданием.
   *
   * Ошибку наружу пропускаем, в отличие от `record`: у уборки нет покупателя,
   * которому нельзя мешать, а молча не удалившиеся строки — это таблица,
   * растущая до тех пор, пока кто-нибудь не заметит место на диске.
   *
   * Граница считается по календарю площадки (`today()` — Ташкент), тем же, по
   * которому строка была записана. Взяв `current_date` в SQL, мы сравнивали бы
   * ташкентские сутки с UTC-сегодня и в пять часов из двадцати четырёх
   * промахивались бы на день — на горизонте в четыреста дней это неважно, но
   * два календаря в одном модуле важны сами по себе.
   */
  async purgeOlderThan(days: number): Promise<number> {
    const removed = await this.repository.purgeOlderThan(
      shiftDay(today(), -days),
    );

    if (removed > 0) {
      this.logger.log(`Ретенция поисковых запросов: удалено строк ${removed}`);
    }
    return removed;
  }
}
