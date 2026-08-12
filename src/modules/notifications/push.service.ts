import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { PushRepository, type PushTarget } from './push.repository';
import type { BroadcastAudience } from './dto/create-broadcast.dto';

/** Что уходит в браузер. Разбирает это service worker в public/sw.js. */
interface PushPayload {
  title: string;
  body: string;
  url?: string;
  /**
   * Метка, по которой браузер решает, заменить прежнее уведомление или
   * показать рядом. Одна на переписку: разговор занимает одну строку в шторке
   * и обновляется, а разные разговоры не затирают друг друга.
   */
  tag?: string;
}

/**
 * Отправка идёт пачками: у каждого запроса свой TLS-хэндшейк к push-сервису
 * браузера, и тысяча подряд заняла бы минуты. Параллелить всё разом тоже
 * нельзя — тысяча одновременных соединений упрётся в лимиты сокетов.
 */
const BATCH_SIZE = 50;

export interface PushCounters {
  delivered: number;
  failed: number;
}

/**
 * Web push: подписки браузера и отправка по ним.
 *
 * Канал необязательный. Без ключей VAPID он молча выключается — подписаться
 * нельзя, рассылка уходит только в Telegram. Это нормальный режим работы, а не
 * ошибка конфигурации: ключи нужны не всем стендам.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    private readonly repository: PushRepository,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('webPush.publicKey');
    const privateKey = this.config.get<string>('webPush.privateKey');
    const subject = this.config.get<string>('webPush.subject')!;

    if (!publicKey || !privateKey) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы — push в браузер выключен',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    this.logger.log('Web push включён');
  }

  /** Ключ отдаётся клиенту: без него браузер не оформит подписку. */
  publicKey(): string | null {
    return this.enabled
      ? (this.config.get<string>('webPush.publicKey') ?? null)
      : null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(data: {
    userId: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<void> {
    return this.repository.upsert(data);
  }

  unsubscribe(endpoint: string): Promise<void> {
    return this.repository.remove(endpoint);
  }

  hasSubscription(userId: number): Promise<boolean> {
    return this.repository.has(userId);
  }

  countAudience(audience: BroadcastAudience): Promise<number> {
    if (!this.enabled) return Promise.resolve(0);
    return this.repository.countAudience(audience);
  }

  /**
   * Рассылка по браузерам.
   *
   * Текст приходит с HTML-разметкой Telegram — в уведомлении браузера теги
   * показались бы как есть, поэтому их снимаем. Сущности разворачиваем: в
   * Telegram «&lt;» обязателен, а здесь это просто «<».
   */
  async broadcast(
    audience: BroadcastAudience,
    text: string,
    title: string,
  ): Promise<PushCounters> {
    if (!this.enabled) return { delivered: 0, failed: 0 };

    const targets = await this.repository.audience(audience);
    if (targets.length === 0) return { delivered: 0, failed: 0 };

    const payload: PushPayload = {
      title,
      body: toPlainText(text),
      url: '/',
    };

    let delivered = 0;
    let failed = 0;
    const dead: number[] = [];

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((target) => this.sendOne(target, payload)),
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          delivered += 1;
          return;
        }
        failed += 1;
        const status = (result.reason as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) dead.push(batch[index].id);
      });
    }

    if (dead.length > 0) {
      await this.repository
        .removeMany(dead)
        .catch((err: unknown) =>
          this.logger.error(
            `Не удалось удалить отозванные подписки: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      this.logger.log(`Удалено отозванных подписок: ${dead.length}`);
    }

    this.logger.log(
      `Push-рассылка: доставлено ${delivered} из ${targets.length}`,
    );
    return { delivered, failed };
  }

  /**
   * Уведомление одному человеку во все его браузеры — новое сообщение в
   * переписке, решение модератора. В отличие от рассылки текст приходит уже
   * готовым, без разметки Telegram, и адрес ведёт туда, где на него ответят.
   *
   * Отозванные подписки вычищаем на ходу: браузер удаляет их при переустановке
   * или чистке данных, и без этого мёртвые записи копились бы навсегда.
   */
  async sendToUser(userId: number, payload: PushPayload): Promise<number> {
    if (!this.enabled) return 0;

    const targets = await this.repository.byUser(userId);
    if (targets.length === 0) return 0;

    const results = await Promise.allSettled(
      targets.map((target) => this.sendOne(target, payload)),
    );

    const dead: number[] = [];
    let delivered = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        delivered += 1;
        return;
      }
      const status = (result.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) dead.push(targets[index].id);
    });

    if (dead.length > 0) {
      await this.repository
        .removeMany(dead)
        .catch((err: unknown) =>
          this.logger.warn(
            `Не удалось удалить отозванные подписки: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    return delivered;
  }

  private sendOne(target: PushTarget, payload: PushPayload): Promise<unknown> {
    return webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      { TTL: 24 * 60 * 60 },
    );
  }
}

/** Снимает разметку Telegram: в уведомлении браузера теги были бы видны. */
function toPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
