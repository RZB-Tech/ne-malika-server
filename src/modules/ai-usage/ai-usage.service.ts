import { Injectable, Logger } from '@nestjs/common';
import { AiUsageRepository } from './ai-usage.repository';
import { FindAiUsageQueryDto } from './dto/find-ai-usage-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';

export interface AiUsageEntry {
  userId: number;
  /** Магазин, с которого списано. `null` у администратора — платит площадка. */
  shopId: number | null;
  operation: 'prompt' | 'description' | 'image' | 'autofill';
  model: string;
  images?: number;
  /** Фактическая стоимость у OpenRouter, если он её вернул. */
  usd?: number;
  /** Сколько кредитов сняли с магазина. */
  credits: number;
  /**
   * Операция не стоила магазину ничего, хотя магазин у неё есть: месячная
   * норма автозаполнений START или безлимит PRO/MAX.
   *
   * Необязательное со значением по умолчанию `false`, а не обязательное: у
   * генерации картинок и правки описания бесплатных веток нет вовсе, и
   * заставлять их писать `free: false` значило бы напоминать про подписки
   * коду, который про них ничего не знает. Ошибиться в другую сторону —
   * забыть `free: true` там, где оно нужно, — можно только в автозаполнении,
   * и там признак считается единственной функцией `autofillOutcome`.
   *
   * Администратор сюда не попадает ни при каких условиях: его строка
   * отличается пустым `shopId`, см. докблок колонки `ai_usage.free`.
   */
  free?: boolean;
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly repository: AiUsageRepository) {}

  /**
   * Записать обращение к ИИ.
   *
   * Ошибку записи глотаем: журнал ведётся ради разбирательств, и уронить из-за
   * него уже выполненную генерацию — значит наказать продавца за нашу проблему
   * с логом. Деньги при этом уже списаны отдельной транзакцией.
   */
  async record(entry: AiUsageEntry): Promise<void> {
    try {
      await this.repository.record({
        userId: entry.userId,
        shopId: entry.shopId,
        operation: entry.operation,
        model: entry.model,
        images: entry.images ?? 0,
        usd: entry.usd,
        credits: entry.credits,
        free: entry.free ?? false,
        estimated: entry.usd === undefined,
      });
    } catch (err) {
      this.logger.error(
        `Не удалось записать журнал использования ИИ: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async list(query: FindAiUsageQueryDto) {
    const { data, total, page, limit } = await this.repository.findAll(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  totals() {
    return this.repository.totals();
  }
}
