import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { RedisService } from '../redis/redis.service';
import { SearchStatsService } from '../search-stats/search-stats.service';
import { escapeHtml } from '../bot/telegram-html';
import { today } from '../product-stats/product-stats.util';
import type { SubscriptionReminder } from '../../db/schema';
import {
  SubscriptionsRepository,
  type ReminderCandidate,
} from './subscriptions.repository';
import { REMINDER_LEAD_DAYS, TZ } from './subscriptions.constants';

type ReminderStage = SubscriptionReminder['stage'];

/**
 * Сколько держится дешёвый предохранитель от параллельного прогона. Шесть
 * часов — заведомо дольше самой длинной рассылки (пауза 70 мс на сообщение) и
 * заведомо короче суток, чтобы завтрашний прогон не наткнулся на вчерашний
 * ключ.
 */
const RUN_CLAIM_TTL_SEC = 6 * 60 * 60;

/**
 * Ретенция журналов, которые растут сами по себе.
 *
 * Четыреста дней — год с запасом: столько живёт вопрос «а меня предупреждали
 * об истечении?» и столько же имеет смысл сравнение поисковых запросов «год к
 * году». Дальше строки не отвечают ни на один вопрос и только занимают место.
 */
const RETENTION_DAYS = 400;

/**
 * Напоминание об истечении подписки и ночная уборка журналов.
 *
 * Оба задания живут здесь, а не в двух сервисах, по практической причине: это
 * единственные в приложении задачи по расписанию, привязанные к подпискам, и
 * искать «кто и когда трогает эти таблицы ночью» удобнее в одном файле. Уборка
 * `shop_search_hits_daily` формально относится к статистике поиска, но
 * собственного расписания у того модуля нет, а заводить второе ночное задание
 * ради одного `DELETE` значит завести и второе место, где о нём забудут.
 *
 * Тексты уведомлений не переводятся: канал русскоязычный, как и весь бот.
 */
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

  /**
   * Раз в сутки в 09:00 по Ташкенту.
   *
   * Не в 10:00: там уже работает `SellerNudgeService`
   * (`notifications/seller-nudge.service.ts:60`), у бота общий лимит около 30
   * сообщений в секунду на всех получателей, а `BULK_DELAY_MS = 70`
   * (`notifications.service.ts:19`) рассчитан с запасом «на то, что параллельно
   * уходят одиночные уведомления». Две массовые задачи в одну минуту этот запас
   * съедят и превратятся во взаимные 429. Напоминание об оплате важнее
   * подталкивания «добавьте товар» — пусть уходит первым и с часовым отрывом.
   */
  @Cron('0 9 * * *', { timeZone: TZ })
  async run(): Promise<void> {
    /**
     * Предохранитель от двух одновременных прогонов — оптимизация, а не
     * гарантия: `RedisService.claim` fails open (возвращает `true` без Redis и
     * при ошибке, см. его докблок). Настоящая защита от повтора — уникальный
     * индекс `subscription_reminders_once_idx`, и держится всё на нём.
     */
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
        `Не удалось выбрать магазины для напоминания: ${message(error)}`,
      );
      return;
    }

    if (candidates.length === 0) {
      this.logger.log('Напоминать об оплате некому — истекающих подписок нет');
      return;
    }

    /**
     * Занятые строки возвращаются одними идентификаторами, а отправлять нужно
     * по названию магазина и сроку. Магазин в выборке ровно один на владельца
     * (`shops_owner_unique_idx`), поэтому карта по `shop_id` однозначна.
     */
    const byShop = new Map(
      candidates.map((candidate) => [candidate.shopId, candidate]),
    );

    /**
     * Право на отправку занимается ВСТАВКОЙ ДО обращения к Telegram, а не
     * отметкой после доставки (как `markNudged` у подталкивания). Порядок
     * важен именно в эту сторону: процесс, упавший на середине пачки, при
     * отметке-после повторил бы рассылку всем, кто уже получил, а при
     * занятии-до потеряет напоминание лишь тем, до кого не дошёл, — и
     * завтрашний прогон их догонит, потому что недоставленные строки
     * удаляются ниже.
     */
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
      this.logger.error(`Не удалось занять напоминания: ${message(error)}`);
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

    /**
     * V9. В Telegram уходят только достижимые, в push — все. `deliver`
     * прерывает пачку целиком после трёх подряд ответов 400, а отправка в
     * `chat_id = null` даёт ровно 400: три подряд продавца без открытого чата
     * с ботом — и остальные напоминания не ушли бы вовсе. У браузерной
     * подписки условие достижимости своё, и чат с ботом ей не нужен.
     */
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
        `Не удалось выбрать адресатов Telegram: ${message(error)}`,
      );
    }

    /**
     * Отправка обёрнута в `try`, хотя `deliver` и не бросает: право на
     * напоминание уже занято вставкой, и любое исключение отсюда до
     * `confirmReminders`/`releaseReminders` оставило бы строки навсегда
     * занятыми — уникальный индекс не дал бы повторить их ни завтра, ни
     * когда-либо. Ценой одного `catch` мы гарантируем, что до уборки
     * управление дойдёт при любом исходе.
     */
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
        `Рассылка напоминаний в Telegram оборвалась: ${message(error)}`,
      );
    }

    /**
     * Push — напрямую через `PushService`, а не через
     * `NotificationsService.pushToUser`: тот проглатывает и ошибку, и число
     * устройств, а в журнал напоминаний пишется именно число. `allSettled`
     * потому, что отказ одной подписки не должен отменять остальные.
     */
    const pushResults = await Promise.allSettled(
      rows.map((row) =>
        this.push.sendToUser(row.ownerId, {
          title:
            stageOf(row.daysLeft) === 'expires_today'
              ? 'Подписка истекает сегодня'
              : 'Подписка скоро закончится',
          body: `${row.shopName}: оплачено до ${formatDate(row.expiresAt)}`,
          url: '/seller/subscription',
          /**
           * Один тег на магазин: напоминание за трое суток схлопывается
           * напоминанием в последний день, а не копится тремя плашками в
           * шторке браузера.
           */
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
          `Push о подписке магазина ${row.shopId} не ушёл: ${message(result.reason)}`,
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

      /**
       * Не дошло ни одним каналом — освобождаем право, чтобы завтрашний прогон
       * попробовал снова. Оставить строку значило бы навсегда записать
       * человеку «предупреждён» по попытке, которой он не видел. Получивших
       * 403 освобождать не нужно и не вредно: `deliver` уже выключил им
       * `telegramNotificationsEnabled`, и завтра они не попадут в достижимых.
       */
      orphaned.push(row.reminderId);
    });

    try {
      await this.repository.confirmReminders(confirmed);
    } catch (error) {
      this.logger.error(
        `Не удалось записать итог напоминаний: ${message(error)}`,
      );
    }

    try {
      await this.repository.releaseReminders(orphaned);
    } catch (error) {
      this.logger.error(
        `Не удалось освободить недоставленные напоминания: ${message(error)}`,
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

  /**
   * Ночная уборка журналов — в 04:00 по Ташкенту.
   *
   * Отдельным заданием и глубокой ночью: оба `DELETE` идут по индексу, но
   * забирают за первый прогон четыреста дней сразу, и делать это в час, когда
   * продавцы открывают отчёты, незачем. Ошибка одного журнала не отменяет
   * уборку второго — они не связаны ничем, кроме времени запуска.
   */
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
        `Не удалось убрать старые поисковые запросы: ${message(error)}`,
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
        `Не удалось убрать старые напоминания: ${message(error)}`,
      );
    }
  }
}

/**
 * Стадия по остатку суток.
 *
 * Ноль — последний оплаченный день, всё остальное в окне — заблаговременное
 * напоминание. Стадия входит в ключ уникальности, поэтому считаться она обязана
 * в одном месте: посчитанная при занятии права по одному правилу, а при выборе
 * текста по другому, она дала бы «истекает сегодня» рядом с датой послезавтра.
 */
function stageOf(daysLeft: number): ReminderStage {
  return daysLeft <= 0 ? 'expires_today' : 'expiring_3d';
}

/** Дата для человека — в поясе площадки, а не в UTC контейнера. */
function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

/**
 * Когда именно кончится — словами.
 *
 * Словами, а не числом с окончанием: значений всего четыре (окно напоминаний —
 * трое суток), и четыре готовые фразы честнее, чем правило склонения, которое
 * придётся сопровождать ради «1 дней».
 */
function whenLeft(daysLeft: number): string {
  if (daysLeft <= 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft} дня`;
}

/**
 * Текст в Telegram.
 *
 * Название магазина — обязательно через `escapeHtml`: сообщения уходят с
 * `parse_mode=HTML`, и магазин с `<` в названии либо сломает разметку, либо
 * заставит Telegram отклонить сообщение — а три отказа подряд обрывают всю
 * пачку (`MAX_BAD_REQUESTS`).
 *
 * Про «оплаченные дни не сгорают» сказано намеренно: без этого продление
 * заранее выглядит как потеря остатка срока, и продавец тянет до последнего
 * дня — то есть ровно до того часа, когда магазин уже выпал из продвижения.
 * Обещание правдивое: период стыкуется, новый месяц прибавляется к остатку
 * прежнего (Д1).
 */
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

/** Текст ошибки, чем бы её ни бросили. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
