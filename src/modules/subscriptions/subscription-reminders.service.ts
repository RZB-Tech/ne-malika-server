import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { RedisService } from '../redis/redis.service';
import { SearchStatsService } from '../search-stats/search-stats.service';
import { escapeHtml } from '../bot/telegram-html';
import { today } from '../product-stats/product-stats.util';
import { errorMessage } from '../../common/errors';
import type { SubscriptionReminder } from '../../db/schema';
import {
  SubscriptionsRepository,
  type ReminderCandidate,
} from './subscriptions.repository';
import { REMINDER_LEAD_DAYS, TZ, formatDate } from './subscriptions.constants';

type ReminderStage = SubscriptionReminder['stage'];

const RUN_CLAIM_TTL_SEC = 6 * 60 * 60;

const RETENTION_DAYS = 400;

@Injectable()
export class SubscriptionRemindersService {
  private readonly logger = new Logger(SubscriptionRemindersService.name);

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
    private readonly searchStats: SearchStatsService,
    private readonly redis: RedisService,
  ) {}

  @Cron('0 9 * * *', { timeZone: TZ })
  async run(): Promise<void> {
    if (!(await this.redis.claim(`subrem:${today()}`, RUN_CLAIM_TTL_SEC))) {
      this.logger.log(
        'Напоминания о подписке за сегодня уже разосланы другим процессом',
      );
      return;
    }

    let candidates: ReminderCandidate[] = [];
    try {
      candidates = await this.repository.reminderCandidates(REMINDER_LEAD_DAYS);
    } catch (error) {
      this.logger.error(
        `Не удалось выбрать магазины для напоминания: ${errorMessage(error)}`,
      );
      return;
    }

    if (candidates.length === 0) {
      this.logger.log('Напоминать об оплате некому — истекающих подписок нет');
      return;
    }

    const byShop = new Map(
      candidates.map((candidate) => [candidate.shopId, candidate]),
    );

    let claimed: { id: number; shopId: number }[] = [];
    try {
      claimed = await this.repository.claimReminders(
        candidates.map((candidate) => ({
          shopId: candidate.shopId,
          stage: stageOf(candidate.daysLeft),
          expiresAt: candidate.expiresAt,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Не удалось занять напоминания: ${errorMessage(error)}`,
      );
      return;
    }

    const rows = claimed.flatMap((claim) => {
      const candidate = byShop.get(claim.shopId);
      return candidate ? [{ reminderId: claim.id, ...candidate }] : [];
    });

    if (rows.length === 0) {
      this.logger.log(
        `Напоминания уже были отправлены: ${candidates.length} магазинов, новых нет`,
      );
      return;
    }

    const textByOwner = new Map(
      rows.map((row) => [row.ownerId, telegramText(row)]),
    );

    let reachable: { id: number; chatId: number }[] = [];
    try {
      reachable = await this.notifications.recipientsByIds(
        rows.map((row) => row.ownerId),
      );
    } catch (error) {
      this.logger.error(
        `Не удалось выбрать адресатов Telegram: ${errorMessage(error)}`,
      );
    }

    let deliveredToTelegram = new Set<number>();
    let telegramDelivered = 0;
    try {
      const telegram = await this.notifications.deliver(
        reachable,
        (recipient) => textByOwner.get(recipient.id) ?? '',
      );
      deliveredToTelegram = new Set(telegram.deliveredIds);
      telegramDelivered = telegram.delivered;
    } catch (error) {
      this.logger.error(
        `Рассылка напоминаний в Telegram оборвалась: ${errorMessage(error)}`,
      );
    }

    const pushResults = await Promise.allSettled(
      rows.map((row) =>
        this.push.sendToUser(row.ownerId, {
          title:
            stageOf(row.daysLeft) === 'expires_today'
              ? 'Подписка истекает сегодня'
              : 'Подписка скоро закончится',
          body: `${row.shopName}: оплачено до ${formatDate(row.expiresAt)}`,
          url: '/seller/subscription',
          tag: `subscription-${row.shopId}`,
        }),
      ),
    );

    const confirmed: { id: number; telegram: boolean; push: number }[] = [];
    const orphaned: number[] = [];
    let pushDelivered = 0;

    rows.forEach((row, index) => {
      const result = pushResults[index];
      if (result.status === 'rejected') {
        this.logger.warn(
          `Push о подписке магазина ${row.shopId} не ушёл: ${errorMessage(result.reason)}`,
        );
      }
      const devices = result.status === 'fulfilled' ? result.value : 0;
      pushDelivered += devices;

      const toTelegram = deliveredToTelegram.has(row.ownerId);
      if (toTelegram || devices > 0) {
        confirmed.push({
          id: row.reminderId,
          telegram: toTelegram,
          push: devices,
        });
        return;
      }

      orphaned.push(row.reminderId);
    });

    try {
      await this.repository.confirmReminders(confirmed);
    } catch (error) {
      this.logger.error(
        `Не удалось записать итог напоминаний: ${errorMessage(error)}`,
      );
    }

    try {
      await this.repository.releaseReminders(orphaned);
    } catch (error) {
      this.logger.error(
        `Не удалось освободить недоставленные напоминания: ${errorMessage(error)}`,
      );
    }

    const soon = rows.filter(
      (row) => stageOf(row.daysLeft) === 'expiring_3d',
    ).length;
    this.logger.log(
      `Напоминания о подписке: ${soon} заранее, ${rows.length - soon} в последний день; ` +
        `Telegram ${telegramDelivered} из ${reachable.length}, браузер ${pushDelivered}; ` +
        `никому не дошло ${orphaned.length}`,
    );
  }

  @Cron('0 4 * * *', { timeZone: TZ })
  async purge(): Promise<void> {
    try {
      const removed = await this.searchStats.purgeOlderThan(RETENTION_DAYS);
      if (removed > 0) {
        this.logger.log(
          `Ретенция поисковых запросов: удалено ${removed} строк старше ${RETENTION_DAYS} дней`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Не удалось убрать старые поисковые запросы: ${errorMessage(error)}`,
      );
    }

    try {
      const removed = await this.repository.purgeReminders(RETENTION_DAYS);
      if (removed > 0) {
        this.logger.log(
          `Ретенция напоминаний: удалено ${removed} строк старше ${RETENTION_DAYS} дней`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Не удалось убрать старые напоминания: ${errorMessage(error)}`,
      );
    }
  }
}

function stageOf(daysLeft: number): ReminderStage {
  return daysLeft <= 0 ? 'expires_today' : 'expiring_3d';
}

function whenLeft(daysLeft: number): string {
  if (daysLeft <= 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft} дня`;
}

function telegramText(row: {
  shopName: string;
  expiresAt: Date;
  daysLeft: number;
}): string {
  const shop = escapeHtml(row.shopName);
  const until = formatDate(row.expiresAt);

  if (stageOf(row.daysLeft) === 'expires_today') {
    return (
      `⏳ <b>Подписка истекает сегодня</b>\n\n` +
      `Магазин <b>${shop}</b> оплачен по ${until} включительно. ` +
      'Продлите подписку, иначе завтра магазин вернётся на бесплатные условия.'
    );
  }

  return (
    `⏳ <b>Подписка заканчивается ${whenLeft(row.daysLeft)}</b>\n\n` +
    `Магазин <b>${shop}</b> оплачен до ${until}. ` +
    'Продлевать можно заранее: оплаченные дни не сгорают, новый месяц прибавится к остатку.'
  );
}
