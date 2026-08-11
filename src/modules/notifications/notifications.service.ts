import { Injectable, Logger } from '@nestjs/common';
import { TelegramApiService } from '../bot/telegram-api.service';
import {
  NotificationsRepository,
  type Recipient,
} from './notifications.repository';
import type { BroadcastAudience } from './dto/create-broadcast.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';

/**
 * Пауза между сообщениями массовой отправки. Telegram разрешает боту около 30
 * сообщений в секунду на всех получателей; берём вдвое меньше — запас на то,
 * что параллельно уходят одиночные уведомления, а 429 стоит дороже задержки.
 */
const BULK_DELAY_MS = 70;

/** Сколько ждать, если Telegram всё же ответил 429 без указания времени. */
const FALLBACK_RETRY_SEC = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DeliveryCounters {
  recipients: number;
  delivered: number;
  failed: number;
  /** Кому реально дошло — нужно тем, кто отмечает факт отправки в БД. */
  deliveredIds: number[];
}

/**
 * Отправка уведомлений в Telegram.
 *
 * Писать боту можно только тем, кто сам нажал /start: до этого чата не
 * существует и Telegram отвечает 403. Поэтому адресатов даёт репозиторий —
 * он и хранит признак «чат открыт», и гасит подписку, когда бот заблокирован.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly telegram: TelegramApiService,
    private readonly repository: NotificationsRepository,
  ) {}

  /**
   * Уведомление администраторам. Ошибку наружу не пробрасываем: уведомление —
   * это побочный эффект, и падение Telegram не должно ронять создание жалобы
   * или проверку товара.
   */
  async notifyAdmins(text: string): Promise<void> {
    try {
      const admins = await this.repository.admins();
      await this.deliver(admins, text);
    } catch (err) {
      this.logger.error(
        `Не удалось уведомить администраторов: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Уведомление одному пользователю. Тоже молча, по той же причине. */
  async notifyUser(userId: number, text: string): Promise<void> {
    try {
      const recipient = await this.repository.one(userId);
      if (!recipient) return;
      await this.deliver([recipient], text);
    } catch (err) {
      this.logger.error(
        `Не удалось уведомить пользователя ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Рассылка из админки. Запись в журнале создаётся до отправки, а счётчики
   * дописываются после: если процесс упадёт на середине, в истории останется
   * след того, что рассылка вообще запускалась.
   */
  async broadcast(
    authorId: number,
    audience: BroadcastAudience,
    text: string,
  ): Promise<DeliveryCounters & { id: number }> {
    const recipients = await this.repository.audience(audience);
    const record = await this.repository.createBroadcast({
      authorId,
      audience,
      text,
      recipients: recipients.length,
    });

    const counters = await this.deliver(recipients, text);
    await this.repository.finishBroadcast(record.id, {
      delivered: counters.delivered,
      failed: counters.failed,
    });

    this.logger.log(
      `Рассылка ${record.id} (${audience}): доставлено ${counters.delivered} из ${counters.recipients}`,
    );
    return { id: record.id, ...counters };
  }

  countAudience(audience: BroadcastAudience): Promise<number> {
    return this.repository.countAudience(audience);
  }

  async listBroadcasts(query: PaginationQueryDto) {
    const { data, total, page, limit } =
      await this.repository.listBroadcasts(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  isLinked(userId: number): Promise<boolean> {
    return this.repository.isLinked(userId);
  }

  /**
   * Последовательная отправка с паузой. Именно последовательная: параллельные
   * запросы к Telegram упираются в лимит и возвращаются пачкой 429, после чего
   * ждать приходится дольше, чем заняла бы аккуратная очередь.
   *
   * Текст можно задать функцией — тогда каждому уходит своё сообщение, но
   * пауза остаётся общей. Это важно для напоминаний: там текст у всех разный,
   * и вызывать deliver по одному адресату означало бы слать без задержки.
   */
  async deliver(
    recipients: Recipient[],
    text: string | ((recipient: Recipient) => string),
  ): Promise<DeliveryCounters> {
    const textFor = typeof text === 'function' ? text : () => text;
    const deliveredIds: number[] = [];
    let failed = 0;

    for (const [index, recipient] of recipients.entries()) {
      if (index > 0) await sleep(BULK_DELAY_MS);

      const body = textFor(recipient);
      let result = await this.telegram.sendMessage(recipient.chatId, body, {
        disablePreview: true,
      });

      // Одна повторная попытка после 429: Telegram сам говорит, сколько ждать.
      if (!result.ok && result.errorCode === 429) {
        await sleep((result.retryAfter ?? FALLBACK_RETRY_SEC) * 1000);
        result = await this.telegram.sendMessage(recipient.chatId, body, {
          disablePreview: true,
        });
      }

      if (result.ok) {
        deliveredIds.push(recipient.id);
        continue;
      }

      failed += 1;
      // 403 — бот заблокирован или чат удалён. Такой адресат не «временно
      // недоступен», он не вернётся сам, поэтому снимаем подписку.
      if (result.errorCode === 403) {
        await this.repository.disableNotifications(recipient.id);
      }
    }

    return {
      recipients: recipients.length,
      delivered: deliveredIds.length,
      failed,
      deliveredIds,
    };
  }
}
