import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramSendResult {
  ok: boolean;
  errorCode?: number;
  description?: string;
  retryAfter?: number;
  payload?: unknown;
}

interface TelegramApiResponse {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);
  private readonly apiBase: string;
  private cachedUsername: string | null = null;

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

  removeKeyboard(chatId: number, text: string): Promise<TelegramSendResult> {
    return this.sendMessage(chatId, text, {
      replyMarkup: { remove_keyboard: true },
    });
  }

  setWebhook(url: string, secretToken?: string): Promise<TelegramSendResult> {
    return this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message'],
    });
  }

  async username(): Promise<string | null> {
    if (this.cachedUsername) return this.cachedUsername;

    const result = await this.call('getMe', {});
    if (!result.ok) return null;

    const payload = result.payload as { username?: string } | undefined;
    if (!payload?.username) {
      this.logger.error('getMe вернул ответ без username');
      return null;
    }

    this.cachedUsername = payload.username;
    return this.cachedUsername;
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

      if (data.ok) return { ok: true, payload: data.result };

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
