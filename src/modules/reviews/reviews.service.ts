import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsRepository } from './reviews.repository';
import {
  ReviewsAiService,
  type ReviewAiResult,
  type ReviewForCheck,
} from './reviews-ai.service';
import { ShopsRepository } from '../shops/shops.repository';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { ProductCardsService } from '../product-cards/product-cards.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { escapeHtml, excerpt } from '../bot/telegram-html';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindReviewsQueryDto } from './dto/find-reviews-query.dto';
import { FindAdminReviewsQueryDto } from './dto/find-admin-reviews-query.dto';

/** Ошибка Postgres «нарушено уникальное ограничение». */
const UNIQUE_VIOLATION = '23505';

/** Если модель забраковала отзыв, но объяснить не смогла. */
const AI_REJECT_FALLBACK = 'Отзыв нарушает правила площадки';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly repository: ReviewsRepository,
    private readonly shopsRepository: ShopsRepository,
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly productCardsService: ProductCardsService,
    private readonly notifications: NotificationsService,
    private readonly reviewsAi: ReviewsAiService,
  ) {}

  // --- покупатель -----------------------------------------------------------

  async create(userId: number, dto: CreateReviewDto) {
    const target = await this.resolveTarget(userId, dto);

    try {
      const review = await this.repository.create({
        authorId: userId,
        shopId: target.shopId,
        productCardId: target.productCardId,
        rating: dto.rating,
        text: dto.text?.trim() || null,
      });

      // Без await: покупателю незачем ждать модель. Отзыв пока не виден —
      // проверка либо опубликует его через несколько секунд, либо оставит
      // человеку.
      this.checkInBackground(review.id);

      return review;
    } catch (err) {
      // Уникальный индекс — последняя защита от двойного отзыва: между
      // проверкой и вставкой человек успевает нажать кнопку дважды.
      if (isUniqueViolation(err)) {
        throw new ConflictException('Вы уже оставляли отзыв здесь');
      }
      throw err;
    }
  }

  /**
   * Правка своего отзыва. Возвращает его на проверку: иначе одобренный текст
   * можно было бы после модерации заменить на любой другой.
   */
  async updateOwn(userId: number, id: number, dto: UpdateReviewDto) {
    const review = await this.getOwnOrThrow(userId, id);

    const updated = await this.repository.update(review.id, {
      rating: dto.rating ?? review.rating,
      text: dto.text === undefined ? review.text : dto.text.trim() || null,
      status: 'pending',
      moderationNote: null,
      moderatedBy: null,
      moderatedAt: null,
      // Прежний вердикт снимаем: он относился к другому тексту.
      aiVerdict: null,
      aiNote: null,
      aiCheckedAt: null,
    });

    await this.productCardsService.invalidateCache();
    this.checkInBackground(review.id);

    return updated;
  }

  async removeOwn(userId: number, id: number) {
    const review = await this.getOwnOrThrow(userId, id);
    await this.repository.delete(review.id);
    await this.productCardsService.invalidateCache();
  }

  listOwn(userId: number, query: FindReviewsQueryDto) {
    return this.paginate(this.repository.listOwn(userId, query));
  }

  // --- витрина --------------------------------------------------------------

  listPublic(query: FindReviewsQueryDto) {
    return this.paginate(
      this.repository.listPublic(query).then((result) => ({
        ...result,
        data: result.data.map((row) => ({
          ...row,
          authorName: shortName(row.authorName),
        })),
      })),
    );
  }

  summary(query: FindReviewsQueryDto) {
    return this.repository.summary(query);
  }

  // --- модерация ------------------------------------------------------------

  listForAdmin(query: FindAdminReviewsQueryDto) {
    return this.paginate(this.repository.listForAdmin(query));
  }

  stats() {
    return this.repository.statusCounts();
  }

  approve(adminId: number, id: number) {
    return this.publish(id, adminId);
  }

  reject(adminId: number, id: number, reason: string) {
    return this.decline(id, adminId, reason);
  }

  /** Ручной повтор проверки — например, когда модель была недоступна. */
  async recheck(id: number) {
    await this.getOrThrow(id);
    await this.runAiCheck(id);
    return { checked: true };
  }

  async adminRemove(id: number) {
    await this.getOrThrow(id);
    await this.repository.delete(id);
    await this.productCardsService.invalidateCache();
  }

  // --- ИИ-модерация ---------------------------------------------------------

  /**
   * Проверка не ожидается вызывающим: покупатель не должен ждать модель, чтобы
   * увидеть, что отзыв принят.
   */
  private checkInBackground(id: number): void {
    void this.runAiCheck(id).catch((err: Error) =>
      this.logger.error(
        `ИИ-проверка отзыва ${id} упала: ${err.message}`,
        err.stack,
      ),
    );
  }

  /**
   * Решение по отзыву.
   *
   * `pass` — публикуем сразу, `fail` — отклоняем с объяснением модели, которое
   * увидит автор. Всё остальное — сомнения модели, недоступный сервис, любая
   * неожиданность — оставляет отзыв человеку. Публиковать непроверенное нельзя,
   * а отклонять от имени модели, которая не ответила, — тем более.
   */
  private async runAiCheck(id: number): Promise<void> {
    const review = await this.repository.findForCheck(id);
    // Отзыв успели удалить или разобрать руками, пока модель думала.
    if (!review || review.status !== 'pending') return;

    const result = await this.reviewsAi.check(review);

    if (!result) {
      void this.notifications.notifyAdmins(
        needsHumanText(review, 'проверка не выполнена — сервис недоступен'),
      );
      return;
    }

    if (result.verdict === 'pass') {
      await this.publish(id, null, result);
      return;
    }

    if (result.verdict === 'fail') {
      await this.decline(id, null, result.note || AI_REJECT_FALLBACK, result);
      return;
    }

    await this.repository.saveAiVerdict(id, result);
    void this.notifications.notifyAdmins(needsHumanText(review, result.note));
  }

  /** `moderatedBy: null` — решение приняла модель, а не человек. */
  private async publish(
    id: number,
    moderatedBy: number | null,
    ai?: ReviewAiResult,
  ) {
    const review = await this.getOrThrow(id);
    const updated = await this.repository.setStatus(id, {
      status: 'approved',
      moderationNote: null,
      moderatedBy,
      ai,
    });

    await this.productCardsService.invalidateCache();

    // Продавцу — о новом отзыве: он появился на его витрине, и реагировать на
    // него ему. Автору сообщать не о чем: он и так видит свой отзыв.
    const shop = await this.shopsRepository.findById(review.shopId);
    if (shop) {
      void this.notifications.notifyUser(
        shop.owner,
        approvedForSellerText(review.rating, review.text),
      );
    }

    return updated;
  }

  private async decline(
    id: number,
    moderatedBy: number | null,
    reason: string,
    ai?: ReviewAiResult,
  ) {
    const review = await this.getOrThrow(id);
    const updated = await this.repository.setStatus(id, {
      status: 'rejected',
      moderationNote: reason,
      moderatedBy,
      ai,
    });

    // Отзыв мог быть опубликован до отказа — тогда оценка изменилась.
    await this.productCardsService.invalidateCache();

    void this.notifications.notifyUser(
      review.authorId,
      rejectedForAuthorText(reason),
    );

    return updated;
  }

  // --- продавец -------------------------------------------------------------

  /** Отзывы о магазине продавца — ровно те, что видит покупатель. */
  async listForOwner(userId: number, query: FindReviewsQueryDto) {
    const shop = await this.ownShopOrThrow(userId);
    return this.listPublic({
      ...query,
      shop_id: shop.id,
      product_id: undefined,
    });
  }

  async summaryForOwner(userId: number) {
    const shop = await this.ownShopOrThrow(userId);
    return this.repository.summary({ shop_id: shop.id });
  }

  // --- внутреннее -----------------------------------------------------------

  /**
   * Куда относится отзыв и вправе ли человек его оставлять.
   *
   * Товар или магазин — ровно одно из двух: «и то и другое» означало бы, что
   * клиент прислал противоречивые данные, и молча выбрать за него нельзя.
   */
  private async resolveTarget(userId: number, dto: CreateReviewDto) {
    if ((dto.productCardId === undefined) === (dto.shopId === undefined)) {
      throw new BadRequestException(
        'Укажите либо товар, либо магазин — что-то одно',
      );
    }

    if (dto.productCardId !== undefined) {
      const card = await this.productCardsRepository.findById(
        dto.productCardId,
      );
      if (!card) throw new NotFoundException('Товар не найден');

      const shop = await this.shopOrThrow(card.shopId, userId);
      return {
        shopId: shop.id,
        productCardId: card.id,
        title: `товар «${card.name}»`,
      };
    }

    const shop = await this.shopOrThrow(dto.shopId!, userId);
    return {
      shopId: shop.id,
      productCardId: undefined,
      title: `магазин «${shop.name}»`,
    };
  }

  /** Оценивать себя нельзя: иначе рейтинг продавца — это его собственное мнение. */
  private async shopOrThrow(shopId: number, userId: number) {
    const shop = await this.shopsRepository.findById(shopId);
    if (!shop) throw new NotFoundException('Магазин не найден');
    if (shop.owner === userId) {
      throw new ForbiddenException('Нельзя оставить отзыв о своём магазине');
    }
    return shop;
  }

  private async ownShopOrThrow(userId: number) {
    const shop = await this.shopsRepository.findFirstByOwner(userId);
    if (!shop) throw new NotFoundException('Магазин не найден');
    return shop;
  }

  private async getOrThrow(id: number) {
    const review = await this.repository.findById(id);
    if (!review) throw new NotFoundException('Отзыв не найден');
    return review;
  }

  private async getOwnOrThrow(userId: number, id: number) {
    const review = await this.repository.findById(id);
    // Один и тот же ответ на «нет отзыва» и «отзыв чужой»: иначе перебором id
    // можно узнать, какие отзывы вообще существуют.
    if (!review || review.authorId !== userId) {
      throw new NotFoundException('Отзыв не найден');
    }
    return review;
  }

  private async paginate<T>(
    source: Promise<{ data: T[]; total: number; page: number; limit: number }>,
  ) {
    const { data, total, page, limit } = await source;
    return buildPaginatedResult(data, total, page, limit);
  }
}

/**
 * Публичное имя автора: имя и первая буква фамилии. Отзывы читают посторонние,
 * и полное имя покупателя рядом с адресом магазина — это уже не про товар.
 */
function shortName(fullname: string): string {
  const [first, second] = fullname.trim().split(/\s+/);
  if (!first) return 'Покупатель';
  return second ? `${first} ${second[0]}.` : first;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/**
 * Уведомление администраторам — только когда решение действительно за
 * человеком. Слать его на каждый отзыв значило бы вернуть ручную модерацию,
 * от которой и уходили.
 */
function needsHumanText(review: ReviewForCheck, reason: string): string {
  const target = review.productName
    ? `товар «${escapeHtml(review.productName)}»`
    : `магазин «${escapeHtml(review.shopName)}»`;

  return (
    `⭐ <b>Отзыв ждёт решения</b> на ${target}\n\n` +
    `Оценка: ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}\n` +
    (review.text ? `${escapeHtml(excerpt(review.text))}\n\n` : '\n') +
    `ИИ: ${escapeHtml(excerpt(reason))}\n\n` +
    `Разобрать: раздел «Отзывы» в админке.`
  );
}

function approvedForSellerText(rating: number, text: string | null): string {
  return (
    `⭐ <b>Новый отзыв о вашем магазине</b>\n\n` +
    `Оценка: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}\n` +
    (text ? `${escapeHtml(excerpt(text))}` : '')
  );
}

function rejectedForAuthorText(reason: string): string {
  return (
    `🚫 <b>Отзыв не опубликован</b>\n\n` +
    `Причина: ${escapeHtml(excerpt(reason))}\n\n` +
    `Отзыв можно поправить в разделе «Мои отзывы» — он снова уйдёт на проверку.`
  );
}
