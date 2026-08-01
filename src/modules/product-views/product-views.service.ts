import { Injectable, NotFoundException } from '@nestjs/common';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductViewsRepository } from './product-views.repository';
import { SyncProductViewsDto } from './dto/sync-product-views.dto';

@Injectable()
export class ProductViewsService {
  constructor(private readonly repository: ProductViewsRepository) {}

  async record(userId: number, productCardId: number) {
    const visible = await this.repository.filterPublicIds([productCardId]);
    if (!visible.has(productCardId)) {
      throw new NotFoundException('Товар не найден или недоступен');
    }

    await this.repository.record(userId, productCardId);
    return { success: true };
  }

  /**
   * Перенос локальной истории после входа. Недоступные товары молча
   * отбрасываются: клиент шлёт то, что накопилось на устройстве за месяцы, и
   * упразднённая за это время карточка — не повод отклонять весь запрос.
   */
  async sync(userId: number, dto: SyncProductViewsDto) {
    const latest = new Map<number, Date>();
    for (const item of dto.items) {
      const viewedAt = item.viewed_at ? new Date(item.viewed_at) : new Date();
      const known = latest.get(item.product_card_id);
      if (!known || known < viewedAt)
        latest.set(item.product_card_id, viewedAt);
    }

    const visible = await this.repository.filterPublicIds([...latest.keys()]);
    const items = [...latest.entries()]
      .filter(([productCardId]) => visible.has(productCardId))
      .map(([productCardId, viewedAt]) => ({ productCardId, viewedAt }));

    const merged = await this.repository.merge(userId, items);
    return { merged, skipped: latest.size - merged };
  }

  async findMine(userId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.findByUser(
      userId,
      query,
    );
    return buildPaginatedResult(data, total, page, limit);
  }

  async remove(userId: number, productCardId: number) {
    const deleted = await this.repository.deleteOne(userId, productCardId);
    if (deleted === 0) {
      throw new NotFoundException('Такого товара нет в вашей истории');
    }
    return { success: true };
  }

  async clear(userId: number) {
    const deleted = await this.repository.clear(userId);
    return { deleted };
  }
}
