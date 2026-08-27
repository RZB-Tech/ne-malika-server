import { Injectable, Logger } from '@nestjs/common';
import { AiUsageRepository } from './ai-usage.repository';
import {
  FindAiUsageQueryDto,
  type AiOperation,
} from './dto/find-ai-usage-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { errorMessage } from '../../common/errors';

interface AiUsageEntry {
  userId: number;
  shopId: number | null;
  operation: AiOperation;
  model: string;
  images?: number;
  usd?: number;
  credits: number;
  free?: boolean;
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly repository: AiUsageRepository) {}

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
        `Не удалось записать журнал использования ИИ: ${errorMessage(err)}`,
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
