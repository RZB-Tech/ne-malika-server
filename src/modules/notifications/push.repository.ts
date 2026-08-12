import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { pushSubscriptions, users } from '../../db/schema';
import type { BroadcastAudience } from './dto/create-broadcast.dto';

/** Подписка в том виде, в каком её ждёт web-push. */
export interface PushTarget {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

@Injectable()
export class PushRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Сохраняет подписку. Тот же endpoint от того же браузера перезаписывается:
   * ключи меняются при перевыпуске подписки, а вторая строка означала бы два
   * одинаковых уведомления на одно устройство.
   */
  async upsert(data: {
    userId: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: data.userId,
          p256dh: data.p256dh,
          auth: data.auth,
          userAgent: data.userAgent,
        },
      });
  }

  async remove(endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
  }

  /** Мёртвые подписки: push-сервис ответил 404/410 — они уже не оживут. */
  async removeMany(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, ids));
  }

  /**
   * Адресаты рассылки в браузере.
   *
   * Роль берём ту же, что и у Telegram-рассылки, — аудитория одна, каналы
   * разные. Заблокированных исключаем: закрытый вход и уведомления о новинках
   * плохо сочетаются.
   */
  audience(audience: BroadcastAudience): Promise<PushTarget[]> {
    const byRole =
      audience === 'sellers'
        ? eq(users.role, 'seller')
        : audience === 'buyers'
          ? eq(users.role, 'user')
          : undefined;

    // Web Push — самостоятельный канал. Подключён ли у пользователя Telegram,
    // здесь неважно: браузерную подписку он включил отдельным действием.
    const base = isNull(users.blockedAt);

    return this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(byRole ? and(base, byRole) : base);
  }

  /**
   * Браузеры одного человека. В отличие от рассылки, здесь не смотрим на
   * `telegram_notifications_enabled`: команда /stop относится к боту, а
   * уведомления в браузере человек включал отдельным нажатием и отключает их
   * там же, в настройках сайта.
   */
  byUser(userId: number): Promise<PushTarget[]> {
    return this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(
        and(eq(pushSubscriptions.userId, userId), isNull(users.blockedAt)),
      );
  }

  /** Сколько браузеров получат рассылку — показывается рядом с числом чатов. */
  countAudience(audience: BroadcastAudience): Promise<number> {
    const byRole =
      audience === 'sellers'
        ? eq(users.role, 'seller')
        : audience === 'buyers'
          ? eq(users.role, 'user')
          : undefined;

    const base = and(
      isNull(users.blockedAt),
      eq(users.telegramNotificationsEnabled, true),
    );

    return this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(byRole ? and(base, byRole) : base)
      .then((rows) => rows[0]?.count ?? 0);
  }

  /** Подписан ли этот браузер — чтобы не предлагать включить дважды. */
  async has(userId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .limit(1);
    return rows.length > 0;
  }
}
