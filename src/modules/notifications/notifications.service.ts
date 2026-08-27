import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TelegramApiService } from '../bot/telegram-api.service';
import type { NotificationChannelsDto } from './dto/notification-channels.dto';
import {
  NotificationsRepository,
  type Recipient,
} from './notifications.repository';
import type { BroadcastAudience } from './dto/create-broadcast.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { clampMessage } from '../bot/telegram-html';
import { PushService } from './push.service';

const BULK_DELAY_MS = 70;

const PUSH_TITLE = 'НеМалика';

const MAX_BAD_REQUESTS = 3;

const FALLBACK_RETRY_SEC = 3;

const BOT_START_PAYLOAD = 'notify';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DeliveryCounters {
  recipients: number;
  delivered: number;
  failed: number;
  deliveredIds: number[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly telegram: TelegramApiService,
    private readonly repository: NotificationsRepository,
    private readonly push: PushService,
  ) {}

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

  async notifyUser(userId: number, text: string): Promise<void> {
    try {
      const recipient = await this.repository.recipient(userId);
      if (!recipient) return;
      await this.deliver([recipient], text);
    } catch (err) {
      this.logger.error(
        `Не удалось уведомить пользователя ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async pushToUser(
    userId: number,
    payload: { title: string; body: string; url?: string; tag?: string },
  ): Promise<void> {
    try {
      await this.push.sendToUser(userId, payload);
    } catch (err) {
      this.logger.error(
        `Push пользователю ${userId} не ушёл: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  recipientsByIds(userIds: number[]): Promise<Recipient[]> {
    return this.repository.recipientsByIds(userIds);
  }

  async channels(userId: number): Promise<NotificationChannelsDto> {
    const [subscribed, telegram, botUsername] = await Promise.all([
      this.push.hasSubscription(userId),
      this.repository.telegramState(userId),
      this.telegram.username(),
    ]);

    return {
      push: {
        available: this.push.isEnabled(),
        publicKey: this.push.publicKey(),
        subscribed,
      },
      telegram: {
        available: botUsername !== null,
        linked: telegram.linked,
        enabled: telegram.enabled,
        url: botUsername
          ? `https://t.me/${botUsername}?start=${BOT_START_PAYLOAD}`
          : null,
      },
    };
  }

  async setTelegram(userId: number, enabled: boolean): Promise<void> {
    if (enabled) {
      const { linked } = await this.repository.telegramState(userId);
      if (!linked) {
        throw new BadRequestException(
          'Сначала откройте чат с ботом — он не может написать первым',
        );
      }
    }

    await this.repository.setTelegramEnabled(userId, enabled);
  }

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

    void this.runBroadcast(record.id, recipients, text, audience);

    return { id: record.id, recipients: recipients.length };
  }

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

    let pushCounters = { delivered: 0, failed: 0 };
    try {
      pushCounters = await this.push.broadcast(audience, text, PUSH_TITLE);
    } catch (err) {
      this.logger.error(
        `Push-рассылка ${id} не удалась: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.repository.finishBroadcast(id, {
        delivered: counters.delivered,
        failed: counters.failed,
        pushDelivered: pushCounters.delivered,
        pushFailed: pushCounters.failed,
      });
    } catch (err) {
      this.logger.error(
        `Не удалось записать итог рассылки ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(
      `Рассылка ${id} (${audience}): Telegram ${counters.delivered} из ${counters.recipients}, ` +
        `браузер ${pushCounters.delivered}`,
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

      const body = clampMessage(textFor(recipient));
      let result = await this.telegram.sendMessage(recipient.chatId, body, {
        disablePreview: true,
      });

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

      if (result.errorCode === 400) {
        badRequests += 1;
        if (badRequests >= MAX_BAD_REQUESTS) {
          this.logger.error(
            `Отправка прервана: Telegram отклоняет текст (${result.description ?? 'без пояснения'})`,
          );
          break;
        }
      }

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
