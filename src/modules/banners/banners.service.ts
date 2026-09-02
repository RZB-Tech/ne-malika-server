import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ShopsService } from '../shops/shops.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  effectiveLimits,
  formatDate,
} from '../subscriptions/subscriptions.constants';
import { escapeHtml, excerpt } from '../bot/telegram-html';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { errorMessage } from '../../common/errors';
import { BannersRepository } from './banners.repository';
import {
  bucketKey,
  MAX_ACTIVE_BANNERS,
  SHOP_BANNER_SLOTS,
  shopBannerLink,
} from './banners.constants';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateShopBannerDto } from './dto/create-shop-banner.dto';
import { UpdateShopBannerDto } from './dto/update-shop-banner.dto';
import { ModerateBannerDto } from './dto/moderate-banner.dto';
import { FindShopBannersQueryDto } from './dto/find-shop-banners-query.dto';

const PLAN_REQUIRED = 'Баннер доступен на тарифе MAX';

const SELLER_BANNER_PATH = '/seller/banner';

function expiryDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

@Injectable()
export class BannersService {
  private readonly logger = new Logger(BannersService.name);

  constructor(
    private readonly repository: BannersRepository,
    private readonly shopsService: ShopsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async findActive() {
    const [platform, shop] = await Promise.all([
      this.repository.findActivePlatform(MAX_ACTIVE_BANNERS),
      this.repository.findActiveShop(bucketKey(), SHOP_BANNER_SLOTS),
    ]);

    const [lead, ...rest] = platform;
    const head = lead ? [lead] : [];

    return [...head, ...shop, ...rest].slice(0, MAX_ACTIVE_BANNERS);
  }

  findAllForAdmin() {
    return this.repository.findAll();
  }

  async create(dto: CreateBannerDto, adminId: number) {
    if (dto.shopId) {
      return this.issueToShop(dto.shopId, dto, adminId);
    }

    const sortOrder =
      dto.sortOrder ?? (await this.repository.maxSortOrder()) + 1;

    return this.repository.create({
      title: dto.title,
      photoRu: dto.photoRu,
      photoUzLatn: dto.photoUzLatn,
      linkUrl: dto.linkUrl || null,
      isActive: dto.isActive ?? true,
      expiresAt: expiryDate(dto.expiresAt),
      sortOrder,
    });
  }

  /**
   * Баннер, выданный магазину площадкой: модерацию проходить не нужно —
   * его собрал администратор, — но показывается он по правилам баннеров
   * магазинов: пока действует тариф MAX и пока не вышел срок.
   */
  private async issueToShop(
    shopId: number,
    dto: CreateBannerDto,
    adminId: number,
  ) {
    const shop = await this.shopsService.getOrThrow(shopId);

    // Слотов у тарифа один, а витрина продавца показывает один баннер:
    // второй просто негде было бы ни увидеть, ни отредактировать.
    const used = await this.repository.countOwned(shop.id);
    if (used >= Math.max(effectiveLimits(shop).bannerSlots, 1)) {
      throw new ConflictException(
        'У магазина уже есть баннер — измените существующий или удалите его',
      );
    }

    await this.assertPhotosExist(dto);

    const banner = await this.repository.create({
      shopId: shop.id,
      title: dto.title,
      photoRu: dto.photoRu,
      photoUzLatn: dto.photoUzLatn,
      linkUrl: dto.linkUrl || shopBannerLink(shop.id),
      isActive: dto.isActive ?? true,
      expiresAt: expiryDate(dto.expiresAt),
      status: 'approved',
      moderatedBy: adminId,
      moderatedAt: new Date(),
      sortOrder: 0,
    });

    this.notifyIssued(shop.owner, banner.id, banner.expiresAt);

    return banner;
  }

  async update(id: number, dto: UpdateBannerDto) {
    await this.getOrFail(id);

    const { linkUrl, expiresAt, shopId, ...rest } = dto;

    if (shopId) {
      await this.shopsService.getOrThrow(shopId);
    }

    return this.repository.update(id, {
      ...rest,
      ...(linkUrl === undefined ? {} : { linkUrl: linkUrl || null }),
      ...(expiresAt === undefined ? {} : { expiresAt: expiryDate(expiresAt) }),
      ...(shopId === undefined ? {} : { shopId: shopId ?? null }),
    });
  }

  async remove(id: number) {
    await this.getOrFail(id);
    await this.repository.delete(id);
  }

  async reorder(ids: number[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) {
      throw new BadRequestException('В порядке есть повторяющиеся id');
    }

    const existing = await this.repository.findAll();
    const known = new Set(existing.map((b) => b.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new BadRequestException(
        `Баннеры не найдены: ${unknown.join(', ')}`,
      );
    }

    await this.repository.applyOrder(ids);
    return this.repository.findAll();
  }

  async findForShop(ownerId: number) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);
    return this.repository.findOwned(shop.id);
  }

  async createForShop(ownerId: number, dto: CreateShopBannerDto) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);

    const slots = effectiveLimits(shop).bannerSlots;
    if (slots <= 0) {
      throw new ForbiddenException(PLAN_REQUIRED);
    }

    const used = await this.repository.countOwned(shop.id);
    if (used >= slots) {
      throw new ConflictException(
        'Баннер уже загружен — отредактируйте существующий',
      );
    }

    await this.assertPhotosExist(dto);

    return this.repository.create({
      shopId: shop.id,
      title: dto.title,
      photoRu: dto.photoRu,
      /**
       * Пусто — ведём на страницу самого магазина: баннер и так про него, а
       * набирать собственный адрес руками продавцу незачем. Стереть ссылку
       * совсем нельзя намеренно — оплаченное место на главной должно
       * куда-то вести.
       */
      photoUzLatn: dto.photoUzLatn,
      linkUrl: dto.linkUrl || shopBannerLink(shop.id),
      status: 'pending',
      isActive: true,
      sortOrder: 0,
    });
  }

  async updateOwn(ownerId: number, id: number, dto: UpdateShopBannerDto) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);

    if (effectiveLimits(shop).bannerSlots <= 0) {
      throw new ForbiddenException(PLAN_REQUIRED);
    }

    const banner = await this.repository.findOwnedByIdAndShop(id, shop.id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }

    await this.assertPhotosExist(dto);

    const { linkUrl, ...rest } = dto;

    return this.repository.update(id, {
      ...rest,
      ...(linkUrl === undefined ? {} : { linkUrl: linkUrl || null }),
      status: 'pending',
      rejectReason: null,
      moderatedBy: null,
      moderatedAt: null,
    });
  }

  async removeOwn(ownerId: number, id: number) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);

    const banner = await this.repository.findOwnedByIdAndShop(id, shop.id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }

    await this.repository.delete(id);
  }

  async findShopBannersForAdmin(query: FindShopBannersQueryDto) {
    const { data, total, page, limit } =
      await this.repository.findShopBanners(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  async moderate(id: number, dto: ModerateBannerDto, adminId: number) {
    const banner = await this.repository.findShopBannerById(id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }

    let rejectReason: string | null = null;
    if (dto.status === 'rejected') {
      const reason = dto.reason?.trim();
      if (!reason) {
        throw new BadRequestException('Укажите причину отказа');
      }
      rejectReason = reason;
    }

    const updated = await this.repository.update(id, {
      status: dto.status,
      rejectReason,
      moderatedBy: adminId,
      moderatedAt: new Date(),
    });

    this.notifyOwner(banner.shopOwner, id, rejectReason);

    return { ...updated, shopName: banner.shopName };
  }

  private async assertPhotosExist(dto: {
    photoRu?: string;
    photoUzLatn?: string;
  }): Promise<void> {
    const keys = [...new Set([dto.photoRu, dto.photoUzLatn])].filter(
      (key): key is string => typeof key === 'string',
    );

    if (keys.length === 0) return;

    const found = await Promise.all(keys.map((key) => this.files.exists(key)));
    if (found.includes(false)) {
      throw new BadRequestException(
        'Изображение не загружено — повторите загрузку файла',
      );
    }
  }

  private notifyOwner(
    ownerId: number,
    bannerId: number,
    rejectReason: string | null,
  ): void {
    const approved = rejectReason === null;

    const text = approved
      ? '✅ <b>Баннер одобрен</b>\n\n' +
        'Он уже показывается в карусели на главной странице.'
      : '🚫 <b>Баннер не одобрен</b>\n\n' +
        `Причина: ${escapeHtml(excerpt(rejectReason))}\n\n` +
        'Поправьте его в разделе «Баннер» — он снова уйдёт на проверку.';

    this.notifications
      .notifyUser(ownerId, text)
      .catch((err: unknown) => this.logNotifyFailure('telegram', ownerId, err));

    this.notifications
      .pushToUser(ownerId, {
        title: approved ? 'Баннер одобрен' : 'Баннер не одобрен',
        body: approved
          ? 'Баннер показывается на главной странице'
          : excerpt(rejectReason, 120),
        url: SELLER_BANNER_PATH,
        tag: `banner-${bannerId}`,
      })
      .catch((err: unknown) => this.logNotifyFailure('push', ownerId, err));
  }

  private notifyIssued(
    ownerId: number,
    bannerId: number,
    expiresAt: Date | null,
  ): void {
    const until = expiresAt
      ? `Он показывается до ${formatDate(expiresAt)}.`
      : 'Он показывается без ограничения по сроку.';

    this.notifications
      .notifyUser(
        ownerId,
        '🎁 <b>Площадка выдала вам баннер</b>\n\n' +
          `${until}\n\n` +
          'Баннер уже в карусели на главной — посмотреть его можно в ' +
          'разделе «Баннер».',
      )
      .catch((err: unknown) => this.logNotifyFailure('telegram', ownerId, err));

    this.notifications
      .pushToUser(ownerId, {
        title: 'Площадка выдала вам баннер',
        body: expiresAt
          ? `Показывается до ${formatDate(expiresAt)}`
          : 'Показывается в карусели на главной',
        url: SELLER_BANNER_PATH,
        tag: `banner-${bannerId}`,
      })
      .catch((err: unknown) => this.logNotifyFailure('push', ownerId, err));
  }

  private logNotifyFailure(
    channel: string,
    ownerId: number,
    err: unknown,
  ): void {
    this.logger.error(
      `Решение по баннеру не доставлено (${channel}) пользователю ${ownerId}: ` +
        errorMessage(err),
    );
  }

  private async getOrFail(id: number) {
    const banner = await this.repository.findById(id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }
    return banner;
  }
}
