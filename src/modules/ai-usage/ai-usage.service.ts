import { Injectable, Logger } from '@nestjs/common';
import { AiUsageRepository } from './ai-usage.repository';
import { FindAiUsageQueryDto } from './dto/find-ai-usage-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';

export interface AiUsageEntry {
  userId: number;
  /** Магазин, с которого списано. `null` у администратора — платит площадка. */
  shopId: number | null;
  operation: 'prompt' | 'description' | 'image';
  model: string;
  images?: number;
  /** Фактическая стоимость у OpenRouter, если он её вернул. */
  usd?: number;
  /** Сколько кредитов сняли с магазина. */
  credits: number;
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
