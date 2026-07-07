import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    options?: { replyMarkup?: unknown },
  ): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: options?.replyMarkup,
    });
  }

  /** Отправляет сообщение с кнопкой запроса контакта (request_contact). */
  async requestContact(chatId: number, text: string): Promise<void> {
    await this.sendMessage(chatId, text, {
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
  async removeKeyboard(chatId: number, text: string): Promise<void> {
    await this.sendMessage(chatId, text, {
      replyMarkup: { remove_keyboard: true },
    });
  }

  async setWebhook(url: string, secretToken?: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message'],
    });
  }

  private async call(
    method: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    try {
      const res = await fetch(`${this.apiBase}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        this.logger.error(
          `Telegram API ${method} failed: ${JSON.stringify(data)}`,
        );
      }
    } catch (err) {
      this.logger.error(`Telegram API ${method} request error`, err as Error);
    }
  }
}
