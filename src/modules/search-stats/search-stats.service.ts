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

import { errorMessage } from '../../common/errors';

@Injectable()
export class SearchStatsService {
  private readonly logger = new Logger(SearchStatsService.name);

  constructor(
    private readonly repository: SearchStatsRepository,
    private readonly redis: RedisService,
  ) {}

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
        `Не удалось записать поисковый запрос: ${errorMessage(err)}`,
      );
    }
  }

  private dedupKey(visitorId: string, query: string): string {
    const digest = createHash('sha1')
      .update(`${visitorId}|${query}`)
      .digest('hex')
      .slice(0, 20);

    return `srch:${digest}`;
  }

  topForShop(
    shopId: number,
    from: string,
    to: string,
    limit: number,
  ): Promise<SearchHitDto[]> {
    return this.repository.topForShop(shopId, from, to, limit);
  }

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
