import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ShopsRepository } from './shops.repository';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import { CreditsService } from '../credits/credits.service';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { PRODUCT_CACHE_PREFIX } from '../product-cards/product-cards.cache';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { FindAdminShopsQueryDto } from './dto/find-admin-shops-query.dto';
import { Shop } from '../../db/schema';
import { isUniqueViolation } from '../../db/errors';
import { errorMessage } from '../../common/errors';

@Injectable()
export class ShopsService {
  private readonly logger = new Logger(ShopsService.name);

  constructor(
    private readonly shopsRepository: ShopsRepository,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly credits: CreditsService,
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
      const shop = await this.shopsRepository.createAndPromoteOwner({
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

      const granted = await this.credits
        .grantWelcome(shop.id)
        .catch((err: unknown) => {
          this.logger.error(
            `Не удалось начислить приветственные кредиты магазину ${shop.id}: ${errorMessage(err)}`,
          );
          return 0;
        });

      return granted
        ? ((await this.shopsRepository.findById(shop.id)) ?? shop)
        : shop;
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

  async getActiveOwnShopOrThrow(ownerId: number): Promise<Shop> {
    const shop = await this.shopsRepository.findFirstByOwner(ownerId);
    if (!shop || shop.status !== 'active') {
      throw new NotFoundException('Магазин не найден');
    }
    return shop;
  }

  async getOwnOrThrow(ownerId: number, shopId: number) {
    return this.findOwnedOrThrow(
      ownerId,
      shopId,
      () => new NotFoundException('Магазин не найден'),
    );
  }

  async updateOwn(ownerId: number, shopId: number, dto: UpdateShopDto) {
    const updated = await this.shopsRepository.updateOwned(
      shopId,
      ownerId,
      dto,
    );
    if (!updated) {
      throw new NotFoundException('Магазин не найден');
    }
    return updated;
  }

  async removeOwn(ownerId: number, shopId: number) {
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

  async adminSetRestrictedCategories(shopId: number, enabled: boolean) {
    await this.getOrThrow(shopId);
    return this.shopsRepository.setRestrictedCategories(shopId, enabled);
  }

  async adminRemove(shopId: number) {
    const shop = await this.getOrThrow(shopId);

    if (await this.credits.hasPaidSubscription(shopId)) {
      throw new ConflictException(
        'Магазин с оплаченной подпиской удалить нельзя — сначала отмените подписку',
      );
    }

    const deleted = await this.shopsRepository.deleteAndDemoteOwner(
      shopId,
      shop.owner,
    );
    if (!deleted) {
      throw new NotFoundException('Магазин не найден');
    }
    await this.redis.delByPrefix(PRODUCT_CACHE_PREFIX);
  }

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

  async getOrThrow(shopId: number) {
    const shop = await this.shopsRepository.findById(shopId);
    if (!shop) {
      throw new NotFoundException('Магазин не найден');
    }
    return shop;
  }

  async assertOwnership(ownerId: number, shopId: number) {
    return this.findOwnedOrThrow(
      ownerId,
      shopId,
      () => new ForbiddenException('Магазин не найден или вам не принадлежит'),
    );
  }

  private async findOwnedOrThrow(
    ownerId: number,
    shopId: number,
    createError: () => Error,
  ) {
    const shop = await this.shopsRepository.findOwnedByIdAndOwner(
      shopId,
      ownerId,
    );
    if (!shop) throw createError();
    return shop;
  }

  private deriveTelegramLink(owner: { telegramUsername: string | null }) {
    return owner.telegramUsername
      ? `https://t.me/${owner.telegramUsername}`
      : undefined;
  }
}
