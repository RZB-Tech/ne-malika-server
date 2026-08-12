import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShopsRepository } from './shops.repository';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { PRODUCT_CACHE_PREFIX } from '../product-cards/product-cards.cache';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { FindAdminShopsQueryDto } from './dto/find-admin-shops-query.dto';
import { Shop } from '../../db/schema';

@Injectable()
export class ShopsService {
  constructor(
    private readonly shopsRepository: ShopsRepository,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
  ) {}

  async createForSeller(ownerId: number, dto: CreateShopDto) {
    const owner = await this.usersService.findById(ownerId);
    if (!owner) {
      throw new NotFoundException('Пользователь не найден');
    }

    const telegramLink = dto.telegramLink ?? this.deriveTelegramLink(owner);
    const contact = dto.contact ?? owner.phoneNumber;

    if (!telegramLink) {
      throw new BadRequestException(
        'Не удалось определить telegram_link по умолчанию — у аккаунта нет username, укажите ссылку явно',
      );
    }
    if (!contact) {
      throw new BadRequestException(
        'Не удалось определить контакт по умолчанию — номер телефона ещё не подтверждён через бота, укажите контакт явно',
      );
    }

    const existingShop = await this.shopsRepository.findFirstByOwner(ownerId);
    if (existingShop) {
      throw new ConflictException('У пользователя уже есть магазин');
    }

    try {
      return await this.shopsRepository.createAndPromoteOwner({
        owner: ownerId,
        name: dto.name,
        description: dto.description,
        photo: dto.photo,
        telegramLink,
        contact,
        address: dto.address,
        workSchedule: dto.workSchedule,
        location: dto.location,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'shops_owner_unique_idx')) {
        throw new ConflictException('У пользователя уже есть магазин');
      }
      throw error;
    }
  }

  listOwn(ownerId: number) {
    return this.shopsRepository.findByOwner(ownerId);
  }

  async getOwnOrThrow(ownerId: number, shopId: number) {
    const shop = await this.shopsRepository.findOwnedByIdAndOwner(
      shopId,
      ownerId,
    );
    if (!shop) {
      throw new NotFoundException('Магазин не найден');
    }
    return shop;
  }

  async updateOwn(ownerId: number, shopId: number, dto: UpdateShopDto) {
    await this.getOwnOrThrow(ownerId, shopId);
    return this.shopsRepository.update(shopId, dto);
  }

  async removeOwn(ownerId: number, shopId: number) {
    await this.getOwnOrThrow(ownerId, shopId);
    const deleted = await this.shopsRepository.deleteAndDemoteOwner(
      shopId,
      ownerId,
    );
    if (!deleted) {
      throw new NotFoundException('Магазин не найден');
    }
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
  }

  async getPublicById(id: number) {
    const shop = await this.shopsRepository.findPublicById(id);
    if (!shop) {
      throw new NotFoundException('Магазин не найден');
    }
    return shop;
  }

  async adminList(query: FindAdminShopsQueryDto) {
    const { data, total, page, limit } =
      await this.shopsRepository.findAllWithProductCount(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  async adminAbolish(shopId: number, reason: string) {
    await this.getOrThrow(shopId);
    const shop = await this.shopsRepository.abolish(shopId, reason);
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
    return shop;
  }

  async adminRestore(shopId: number) {
    await this.getOrThrow(shopId);
    const shop = await this.shopsRepository.restore(shopId);
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
    return shop;
  }

  /**
   * Удаление админом — в отличие от упразднения, необратимо: товары уходят
   * каскадом, а владелец перестаёт быть продавцом.
   */
  async adminRemove(shopId: number) {
    const shop = await this.getOrThrow(shopId);
    const deleted = await this.shopsRepository.deleteAndDemoteOwner(
      shopId,
      shop.owner,
    );
    if (!deleted) {
      throw new NotFoundException('Магазин не найден');
    }
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
  }

  /** Проверка существования без владельца — нужна админским операциям. */
  getOrThrowById(shopId: number) {
    return this.getOrThrow(shopId);
  }

  /**
   * Упразднённый магазин не принимает новые товары: он и его выдача уже скрыты
   * от покупателя, и добавленный туда товар просто пропал бы без объяснений.
   */
  assertAcceptsProducts(shop: Shop) {
    if (shop.status !== 'active') {
      throw new ForbiddenException(
        shop.abolishReason
          ? `Магазин упразднён: ${shop.abolishReason}. Добавлять товары нельзя.`
          : 'Магазин упразднён — добавлять товары нельзя',
      );
    }
    return shop;
  }

  private async getOrThrow(shopId: number) {
    const shop = await this.shopsRepository.findById(shopId);
    if (!shop) {
      throw new NotFoundException('Магазин не найден');
    }
    return shop;
  }

  /** Используется ProductCardsService для проверки принадлежности при создании товара. */
  async assertOwnership(ownerId: number, shopId: number) {
    const shop = await this.shopsRepository.findOwnedByIdAndOwner(
      shopId,
      ownerId,
    );
    if (!shop) {
      throw new ForbiddenException('Магазин не найден или вам не принадлежит');
    }
    return shop;
  }

  private deriveTelegramLink(owner: { telegramUsername: string | null }) {
    return owner.telegramUsername
      ? `https://t.me/${owner.telegramUsername}`
      : undefined;
  }
}

function isUniqueViolation(error: unknown, constraint: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'constraint' in error &&
    error.code === '23505' &&
    error.constraint === constraint
  );
}
