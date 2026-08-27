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

      /**
       * Приветственные кредиты на пробную генерацию. Без права сорвать
       * регистрацию: магазин уже в базе, и падение подарка не должно
       * возвращаться продавцу ошибкой. Недоданное видно в логе и доначисляется
       * руками из админки.
       */
      const granted = await this.credits
        .grantWelcome(shop.id)
        .catch((err: unknown) => {
          this.logger.error(
            `Не удалось начислить приветственные кредиты магазину ${shop.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return 0;
        });

      /* Строка прочитана до начисления — перечитываем, иначе продавец увидит
         в ответе нулевой баланс при уже начисленных кредитах. */
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

  /**
   * Магазин продавца — тот единственный, что у него есть (V13).
   *
   * Заведён потому, что подписка, баннеры, аналитика и кредиты спрашивают
   * «магазин этого человека» без всякого идентификатора в пути: у продавца он
   * один (`shops_owner_unique_idx`), и просить его номер значило бы завести
   * параметр, который придётся проверять на принадлежность — а однажды забыть.
   * Существующий `getOwnOrThrow(ownerId, shopId)` для этого не годится: он
   * отвечает на другой вопрос — «этот ли магазин принадлежит этому человеку».
   *
   * Проверка `status === 'active'` обязательна и стоит здесь, а не у каждого
   * вызывающего. Упразднённый магазин скрыт от покупателя целиком: продавать
   * его владельцу подписку, показывать ему баннерные слоты и списывать за это
   * деньги — значит брать плату за витрину, которой нет. Ровно этот же фильтр
   * стоит в `CreditsRepository.findShopIdByOwner`, и разъехаться им нельзя.
   *
   * 404, а не 403: для владельца упразднённого магазина его больше нет, а
   * «доступ запрещён» на собственный магазин читается как ошибка площадки.
   */
  async getActiveOwnShopOrThrow(ownerId: number): Promise<Shop> {
    const shop = await this.shopsRepository.findFirstByOwner(ownerId);
    if (!shop || shop.status !== 'active') {
      throw new NotFoundException('Магазин не найден');
    }
    return shop;
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
   * Разрешение на закрытые разделы каталога — «Смартфоны» и «Планшеты».
   *
   * Снятие разрешения не трогает уже выложенные товары: покупатель их видел, а
   * молча снести витрину магазина из-за отозванного доступа мы не вправе.
   * Перевести туда новый товар после этого нельзя — и этого достаточно.
   */
  async adminSetRestrictedCategories(shopId: number, enabled: boolean) {
    await this.getOrThrow(shopId);
    return this.shopsRepository.setRestrictedCategories(shopId, enabled);
  }

  /**
   * Удаление админом — в отличие от упразднения, необратимо: товары уходят
   * каскадом, а владелец перестаёт быть продавцом.
   *
   * Магазин с оплаченной подпиской удалить нельзя (V6). Причина не в правах, а
   * в каскаде: `subscription_payments.shop_id` объявлен `ON DELETE CASCADE`, и
   * удаление магазина унесло бы вместе с ним журнал платежей — то есть
   * единственное доказательство того, что деньги вообще приходили. Разбирать
   * потом обращение «я платил, верните» будет нечем, а Click со своей стороны
   * транзакцию помнит.
   *
   * Каскад при этом оставлен как есть. Заменить его на `set null` значило бы
   * получить строки платежей без магазина, которые не показать ни в одном
   * списке; `restrict` дал бы ту же ошибку, но из базы, без внятного текста
   * администратору. Проверка здесь — единственный вариант, который объясняет,
   * что делать: сначала отмена подписки, потом удаление.
   */
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
