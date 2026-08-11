import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Чем закончилась отправка. Раньше метод возвращал void и глотал ошибку — для
 * одиночного сообщения это терпимо, но рассылке нужно знать судьбу каждого:
 * 403 означает «бот заблокирован, больше не пишем», 429 — «подожди столько-то».
 */
export interface TelegramSendResult {
  ok: boolean;
  /** Код ошибки Telegram: 403 — бот заблокирован или чат не начат, 429 — лимит. */
  errorCode?: number;
  description?: string;
  /** Сколько секунд просит подождать Telegram при 429. */
  retryAfter?: number;
}

interface TelegramApiResponse {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);
  private readonly apiBase: string;

  constructor(private readonly configService: ConfigService) {
    const botToken = this.configService.get<string>('telegram.botToken');
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(
    chatId: number,
    text: string,
    options?: { replyMarkup?: unknown; disablePreview?: boolean },
  ): Promise<TelegramSendResult> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: options?.replyMarkup,
      link_preview_options: options?.disablePreview
        ? { is_disabled: true }
        : undefined,
    });
  }

  /** Отправляет сообщение с кнопкой запроса контакта (request_contact). */
  requestContact(chatId: number, text: string): Promise<TelegramSendResult> {
    return this.sendMessage(chatId, text, {
      replyMarkup: {
        keyboard: [
          [{ text: '📱 Поделиться номером телефона', request_contact: true }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  /** Убирает кастомную клавиатуру после успешного получения контакта. */
  removeKeyboard(chatId: number, text: string): Promise<TelegramSendResult> {
    return this.sendMessage(chatId, text, {
      replyMarkup: { remove_keyboard: true },
    });
  }

  /**
   * Результат возвращается наружу: раньше отказ Telegram здесь терялся, и
   * приложение писало в журнал «вебхук зарегистрирован» даже когда токен был
   * неверным, а бот не получал ни одного апдейта.
   */
  setWebhook(url: string, secretToken?: string): Promise<TelegramSendResult> {
    return this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message'],
    });
  }

  private async call(
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramSendResult> {
    try {
      const res = await fetch(`${this.apiBase}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as TelegramApiResponse;

      if (data.ok) return { ok: true };

      if (data.error_code !== 403) {
        this.logger.error(
          `Telegram API ${method} failed: ${JSON.stringify(data)}`,
        );
      }

      return {
        ok: false,
        errorCode: data.error_code,
        description: data.description,
        retryAfter: data.parameters?.retry_after,
      };
    } catch (err) {
      this.logger.error(`Telegram API ${method} request error`, err as Error);
      return {
        ok: false,
        description: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
