import { Injectable, NotFoundException } from '@nestjs/common';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FavoritesRepository } from './favorites.repository';
import { SyncFavoritesDto } from './dto/sync-favorites.dto';

@Injectable()
export class FavoritesService {
  constructor(private readonly repository: FavoritesRepository) {}

  async add(userId: number, productCardId: number) {
    const visible = await this.repository.filterPublicIds([productCardId]);
    if (!visible.has(productCardId)) {
      throw new NotFoundException('Товар не найден или недоступен');
    }

    await this.repository.add(userId, productCardId);
    return { success: true };
  }

  /**
   * Перенос локального избранного после входа. Недоступные товары молча
   * отбрасываются: список копился месяцами, и упразднённая за это время
   * карточка — не повод отклонить весь запрос.
   */
  async sync(userId: number, dto: SyncFavoritesDto) {
    const earliest = new Map<number, Date>();
    for (const item of dto.items) {
      const addedAt = item.added_at ? new Date(item.added_at) : new Date();
      const known = earliest.get(item.product_card_id);
      if (!known || known > addedAt) {
        earliest.set(item.product_card_id, addedAt);
      }
    }

    const visible = await this.repository.filterPublicIds([...earliest.keys()]);
    const items = [...earliest.entries()]
      .filter(([productCardId]) => visible.has(productCardId))
      .map(([productCardId, addedAt]) => ({ productCardId, addedAt }));

    const merged = await this.repository.merge(userId, items);
    return { merged, skipped: earliest.size - merged };
  }

  async findMine(userId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.findByUser(
      userId,
      query,
    );
    return buildPaginatedResult(data, total, page, limit);
  }

  async remove(userId: number, productCardId: number) {
    const deleted = await this.repository.remove(userId, productCardId);
    if (deleted === 0) {
      throw new NotFoundException('Такого товара нет в избранном');
    }
    return { success: true };
  }

  async clear(userId: number) {
    const deleted = await this.repository.clear(userId);
    return { deleted };
  }
}
