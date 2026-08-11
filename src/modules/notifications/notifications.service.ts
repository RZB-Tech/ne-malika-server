import { Injectable, Logger } from '@nestjs/common';
import { TelegramApiService } from '../bot/telegram-api.service';
import {
  NotificationsRepository,
  type Recipient,
} from './notifications.repository';
import type { BroadcastAudience } from './dto/create-broadcast.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { clampMessage } from '../bot/telegram-html';

/**
 * Пауза между сообщениями массовой отправки. Telegram разрешает боту около 30
 * сообщений в секунду на всех получателей; берём вдвое меньше — запас на то,
 * что параллельно уходят одиночные уведомления, а 429 стоит дороже задержки.
 */
const BULK_DELAY_MS = 70;

/** Сколько подряд отказов «неверный запрос» считаем сломанным текстом. */
const MAX_BAD_REQUESTS = 3;

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

  /**
   * Рассылка из админки. Запись в журнале создаётся до отправки, а счётчики
   * дописываются после: если процесс упадёт на середине, в истории останется
   * след того, что рассылка вообще запускалась.
   */
  async broadcast(
    authorId: number,
    audience: BroadcastAudience,
    text: string,
  ): Promise<{ id: number; recipients: number }> {
    const recipients = await this.repository.audience(audience);
    const record = await this.repository.createBroadcast({
      authorId,
      audience,
      text,
      recipients: recipients.length,
    });

    // Доставка идёт в фоне, ответ уходит сразу. Синхронно это была бы минута
    // ожидания на каждую тысячу адресатов (пауза 70 мс между сообщениями) —
    // столько ни один прокси соединение не держит, а админ видел бы таймаут
    // при фактически успешной рассылке.
    void this.runBroadcast(record.id, recipients, text, audience);

    return { id: record.id, recipients: recipients.length };
  }

  /** Фоновая часть рассылки: считает и дописывает результат в журнал. */
  private async runBroadcast(
    id: number,
    recipients: Recipient[],
    text: string,
    audience: BroadcastAudience,
  ): Promise<void> {
    let counters: DeliveryCounters = {
      recipients: recipients.length,
      delivered: 0,
      failed: 0,
      deliveredIds: [],
    };
    try {
      counters = await this.deliver(recipients, text);
    } catch (err) {
      this.logger.error(
        `Рассылка ${id} прервана: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.repository.finishBroadcast(id, {
        delivered: counters.delivered,
        failed: counters.failed,
      });
    } catch (err) {
      this.logger.error(
        `Не удалось записать итог рассылки ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(
      `Рассылка ${id} (${audience}): доставлено ${counters.delivered} из ${counters.recipients}`,
    );
  }

  countAudience(audience: BroadcastAudience): Promise<number> {
    return this.repository.countAudience(audience);
  }

  async listBroadcasts(query: PaginationQueryDto) {
    const { data, total, page, limit } =
      await this.repository.listBroadcasts(query);
    return buildPaginatedResult(data, total, page, limit);
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
    let badRequests = 0;

    for (const [index, recipient] of recipients.entries()) {
      if (index > 0) await sleep(BULK_DELAY_MS);

      // Обрезка здесь, а не у каждого вызывающего: длину сообщения задаёт
      // Telegram, и забыть про неё в одном месте достаточно, чтобы
      // уведомление молча не дошло.
      const body = clampMessage(textFor(recipient));
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
        badRequests = 0;
        continue;
      }

      failed += 1;

      // 400 — почти всегда сломанная HTML-разметка в тексте: она одинакова для
      // всех, и продолжать значит собрать тысячу одинаковых отказов и тысячу
      // строк в журнале. Несколько подряд — обрываем.
      if (result.errorCode === 400) {
        badRequests += 1;
        if (badRequests >= MAX_BAD_REQUESTS) {
          this.logger.error(
            `Отправка прервана: Telegram отклоняет текст (${result.description ?? 'без пояснения'})`,
          );
          break;
        }
      }

      // 403 — бот заблокирован или чат удалён. Такой адресат не «временно
      // недоступен», он не вернётся сам, поэтому снимаем подписку.
      // Ошибка записи не должна ронять всю рассылку на середине.
      if (result.errorCode === 403) {
        try {
          await this.repository.disableNotifications(recipient.id);
        } catch (err) {
          this.logger.error(
            `Не удалось снять подписку у ${recipient.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
