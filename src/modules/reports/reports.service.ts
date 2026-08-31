import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportsRepository } from './reports.repository';
import { ShopsRepository } from '../shops/shops.repository';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { CreateReportDto } from './dto/create-report.dto';
import { FindReportsQueryDto } from './dto/find-reports-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { isUniqueViolation } from '../../db/errors';
import { escapeHtml, excerpt } from '../bot/telegram-html';

@Injectable()
export class ReportsService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly shopsRepository: ShopsRepository,
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: number, dto: CreateReportDto) {
    const shop = await this.shopsRepository.findById(dto.shop_id);
    if (!shop) {
      throw new NotFoundException('Магазин не найден');
    }

    if (shop.owner === userId) {
      throw new ForbiddenException('Нельзя пожаловаться на свой магазин');
    }

    if (dto.product_card_id) {
      const card = await this.productCardsRepository.findById(
        dto.product_card_id,
      );
      if (!card) {
        throw new NotFoundException('Товар не найден');
      }
      if (card.shopId !== dto.shop_id) {
        throw new BadRequestException(
          'Товар не принадлежит указанному магазину',
        );
      }
    }

    let report: Awaited<ReturnType<ReportsRepository['create']>>;
    try {
      report = await this.reportsRepository.create({
        context: dto.context,
        authorId: userId,
        shopId: dto.shop_id,
        productCardId: dto.product_card_id,
      });
    } catch (err) {
      // Уникальный индекс — единственное место, где гонка двух одновременных
      // запросов ловится честно: предварительный SELECT её пропускает.
      if (isUniqueViolation(err)) {
        throw new ConflictException('Вы уже жаловались на это');
      }
      throw err;
    }

    // Уведомление после вставки: дубль до админов уже не доедет.
    void this.notifications.notifyAdmins(
      newReportText(shop.name, dto.product_card_id, dto.context),
    );

    return report;
  }

  async findAllForAdmin(query: FindReportsQueryDto) {
    const { data, total, page, limit } =
      await this.reportsRepository.findAll(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  async adminRemove(id: number) {
    const deleted = await this.reportsRepository.deleteReturningId(id);
    if (deleted === 0) {
      throw new NotFoundException('Жалоба не найдена');
    }
  }
}

function newReportText(
  shopName: string,
  productCardId: number | undefined,
  context: string,
): string {
  const target = productCardId
    ? `товар #${productCardId} (${escapeHtml(shopName)})`
    : `магазин «${escapeHtml(shopName)}»`;

  return (
    `🚩 <b>Новая жалоба</b> на ${target}\n\n` +
    `${escapeHtml(excerpt(context))}\n\n` +
    `Разобрать: раздел «Жалобы» в админке.`
  );
}
