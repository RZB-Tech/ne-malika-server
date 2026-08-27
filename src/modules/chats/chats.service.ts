import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatsRepository,
  type ChatMessageRow,
  type ChatRow,
  type ChatWithOwner,
} from './chats.repository';
import { ChatEventsService } from './chat-events.service';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';
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
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';

const NOTIFY_EXCERPT = 200;

@Injectable()
export class ChatsService {
  constructor(
    private readonly repository: ChatsRepository,
    private readonly events: ChatEventsService,
    private readonly productCards: ProductCardsRepository,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
  ) {}

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

  unread(user: AuthenticatedUser) {
    return this.repository.unreadTotals(user.id);
  }

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
      page.data.map(toMessageDto),
      page.total,
      page.page,
      page.limit,
    );
  }

  async start(user: AuthenticatedUser, dto: StartChatDto) {
    const { shopId, productCardId, productName } =
      await this.resolveTarget(dto);

    const shop = await this.shops.getOrThrow(shopId);
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
    void this.notify(chat, side, text, recipient);

    return toMessageDto(message);
  }

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
      const { page, limit } = resolvePage(query);
      return { data: [], total: 0, page, limit };
    }
    return this.repository.findForShop(shop.id, query);
  }

  private async notify(
    chat: ChatWithOwner,
    side: 'buyer' | 'seller',
    text: string,
    recipient: number,
  ): Promise<void> {
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
        tag: `chat-${chat.id}`,
      }),
    ]);
  }
}

function toMessageDto(row: ChatMessageRow) {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function toChatDto(row: ChatRow, role: ChatRole): ChatDto {
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
