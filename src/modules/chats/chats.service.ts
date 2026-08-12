import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatsRepository, type ChatWithOwner } from './chats.repository';
import { ChatEventsService } from './chat-events.service';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { escapeHtml, excerpt } from '../bot/telegram-html';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  type ChatDto,
  type ChatRole,
  FindChatsQueryDto,
  SendMessageDto,
  StartChatDto,
} from './dto/chat.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Сколько текста уходит в уведомление — остальное человек прочитает в чате. */
const NOTIFY_EXCERPT = 200;

/**
 * Пауза между уведомлениями об одной переписке.
 *
 * Без неё живой диалог из десяти реплик — это десять звонков телефона подряд.
 * С ней приходит первое сообщение очереди, а остальные человек видит, когда
 * откроет чат. Две минуты — примерно столько длится пауза, после которой
 * разговор считают возобновившимся.
 */
const NOTIFY_COOLDOWN_SEC = 120;
const NOTIFY_PREFIX = 'chatnotify:';

/**
 * Внутренняя переписка покупателя с магазином.
 *
 * Зачем она при живом телеграме: разговор о товаре остаётся на площадке. Его
 * видно обеим сторонам в кабинете, он привязан к карточке, переживает смену
 * телефона — и, главное, это то место, где потом сможет отвечать ИИ, пока
 * продавец спит. Телеграм-кнопку он не отменяет: кому удобнее там, тот пишет
 * туда.
 */
@Injectable()
export class ChatsService {
  constructor(
    private readonly repository: ChatsRepository,
    private readonly events: ChatEventsService,
    private readonly productCards: ProductCardsRepository,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  /** Список переписок с той стороны, с которой смотрят. */
  async list(user: AuthenticatedUser, query: FindChatsQueryDto) {
    const role: ChatRole = query.role ?? 'buyer';

    const page =
      role === 'seller'
        ? await this.listForSeller(user, query)
        : await this.repository.findForBuyer(user.id, query);

    return buildPaginatedResult(
      page.data.map((row) => toChatDto(row, role)),
      page.total,
      page.page,
      page.limit,
    );
  }

  /** Непрочитанное в обеих ролях — для значка в меню. */
  unread(user: AuthenticatedUser) {
    return this.repository.unreadTotals(user.id);
  }

  /**
   * Лента сообщений. Заодно отмечает их прочитанными: запрашивают её только
   * когда переписка открыта на экране, а отдельная кнопка «я прочитал» — это
   * лишний круг к серверу ради того же самого.
   */
  async messages(
    user: AuthenticatedUser,
    chatId: number,
    query: PaginationQueryDto,
  ) {
    const { chat, side } = await this.access(user, chatId);

    const page = await this.repository.listMessages(chat.id, query);
    const unread = side === 'buyer' ? chat.buyerUnread : chat.sellerUnread;
    await this.repository.markRead(chat.id, side);

    if (unread > 0) {
      this.events.emit(side === 'buyer' ? chat.ownerId : chat.buyerId, {
        chatId: chat.id,
        kind: 'read',
      });
    }

    return buildPaginatedResult(
      page.data.map((row) => ({
        id: row.id,
        kind: row.kind,
        text: row.text,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
      page.total,
      page.page,
      page.limit,
    );
  }

  /**
   * Начать разговор или продолжить начатый. Повторное нажатие «написать» на той
   * же карточке не должно плодить пустые переписки — поэтому find-or-create, а
   * не create.
   */
  async start(user: AuthenticatedUser, dto: StartChatDto) {
    const { shopId, productCardId, productName } =
      await this.resolveTarget(dto);

    const shop = await this.shops.getOrThrowById(shopId);
    if (shop.owner === user.id) {
      throw new BadRequestException(
        'Это ваш магазин — писать самому себе незачем',
      );
    }

    const existing = await this.repository.findExisting(
      user.id,
      shopId,
      productCardId,
    );
    const chat =
      existing ??
      (await this.repository.create({
        buyerId: user.id,
        shopId,
        productCardId,
        productName,
      }));

    await this.send(user, chat.id, { text: dto.text });
    return { id: chat.id };
  }

  async send(user: AuthenticatedUser, chatId: number, dto: SendMessageDto) {
    const { chat, side } = await this.access(user, chatId);

    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Сообщение пустое');

    const message = await this.repository.addMessage({
      chatId: chat.id,
      senderId: user.id,
      kind: side,
      text,
    });

    const recipient = side === 'buyer' ? chat.ownerId : chat.buyerId;

    this.events.emit(recipient, { chatId: chat.id, kind: 'message' });
    void this.notify(chat, side, text);

    return {
      id: message.id,
      kind: message.kind,
      text: message.text,
      readAt: message.readAt,
      createdAt: message.createdAt,
    };
  }

  /**
   * Кто перед нами: покупатель этой переписки или владелец магазина. Все
   * остальные — посторонние, и о существовании чата им знать незачем, поэтому
   * 404, а не 403.
   */
  private async access(
    user: AuthenticatedUser,
    chatId: number,
  ): Promise<{ chat: ChatWithOwner; side: 'buyer' | 'seller' }> {
    const chat = await this.repository.findById(chatId);
    if (!chat) throw new NotFoundException('Переписка не найдена');

    if (chat.buyerId === user.id) return { chat, side: 'buyer' };
    if (chat.ownerId === user.id) return { chat, side: 'seller' };

    throw new NotFoundException('Переписка не найдена');
  }

  /** Магазин и товар, о котором пишут. Товар должен быть на витрине. */
  private async resolveTarget(dto: StartChatDto): Promise<{
    shopId: number;
    productCardId: number | null;
    productName: string | null;
  }> {
    if (dto.productCardId === undefined) {
      if (dto.shopId === undefined) {
        throw new BadRequestException('Укажите товар или магазин');
      }
      return { shopId: dto.shopId, productCardId: null, productName: null };
    }

    const card = await this.productCards.findPublicById(dto.productCardId);
    if (!card) throw new NotFoundException('Товар не найден или недоступен');

    return {
      shopId: card.shopId,
      productCardId: card.id,
      productName: card.name,
    };
  }

  private async listForSeller(
    user: AuthenticatedUser,
    query: FindChatsQueryDto,
  ) {
    const shops = await this.shops.listOwn(user.id);
    const shop = shops[0];
    if (!shop) {
      return {
        data: [],
        total: 0,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      };
    }
    return this.repository.findForShop(shop.id, query);
  }

  /**
   * Уведомление второй стороне — в Telegram и в браузер.
   *
   * Побочный эффект: падение любого из каналов не должно ронять отправку
   * сообщения, поэтому вызывается без ожидания и с ловушкой.
   */
  private async notify(
    chat: ChatWithOwner,
    side: 'buyer' | 'seller',
    text: string,
  ): Promise<void> {
    const recipient = side === 'buyer' ? chat.ownerId : chat.buyerId;
    if (!(await this.shouldNotify(chat.id, recipient))) return;

    const from =
      side === 'buyer'
        ? 'покупателя'
        : `магазина «${escapeHtml(chat.shopName)}»`;
    const excerptText = escapeHtml(excerpt(text, NOTIFY_EXCERPT));

    await Promise.allSettled([
      this.notifications.notifyUser(
        recipient,
        `💬 <b>Новое сообщение</b> от ${from}\n\n${excerptText}\n\n` +
          'Ответить: раздел «Сообщения» на сайте.',
      ),
      this.notifications.pushToUser(recipient, {
        title: side === 'buyer' ? 'Новое сообщение' : chat.shopName,
        body: excerpt(text, NOTIFY_EXCERPT),
        url: side === 'buyer' ? '/seller/messages' : '/messages',
      }),
    ]);
  }

  /**
   * Не частим. Отметку ставим до отправки: два сообщения подряд не должны
   * разойтись в две одинаковые тревоги, пока первое ещё уходит.
   *
   * Без Redis ограничитель молча выключается — уведомление важнее тишины.
   */
  private async shouldNotify(
    chatId: number,
    recipientId: number,
  ): Promise<boolean> {
    if (!this.redis.enabled) return true;

    const key = `${NOTIFY_PREFIX}${chatId}:${recipientId}`;
    if (await this.redis.get(key)) return false;

    await this.redis.set(key, 1, NOTIFY_COOLDOWN_SEC);
    return true;
  }
}

/** Строка списка → ответ. Непрочитанное берём то, что относится к смотрящему. */
function toChatDto(
  row: {
    id: number;
    shopId: number;
    shopName: string;
    shopPhoto: string | null;
    buyerId: number;
    buyerName: string;
    buyerPhoto: string | null;
    productCardId: number | null;
    productName: string | null;
    productPhotos: string[] | null;
    lastMessageText: string | null;
    lastMessageAt: Date;
    buyerUnread: number;
    sellerUnread: number;
  },
  role: ChatRole,
): ChatDto {
  return {
    id: row.id,
    shopId: row.shopId,
    shopName: row.shopName,
    shopPhoto: row.shopPhoto,
    buyerId: row.buyerId,
    buyerName: row.buyerName,
    buyerPhoto: row.buyerPhoto,
    productCardId: row.productCardId,
    productName: row.productName,
    productPhoto: row.productPhotos?.[0] ?? null,
    lastMessageText: row.lastMessageText,
    lastMessageAt: row.lastMessageAt.toISOString(),
    unread: role === 'seller' ? row.sellerUnread : row.buyerUnread,
  };
}
