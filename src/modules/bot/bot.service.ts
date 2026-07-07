import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UsersRepository } from '../users/users.repository';
import { TelegramApiService } from './telegram-api.service';
import { TelegramMessage, TelegramUpdate } from './types/telegram-update.types';
import { ConfigService } from '@nestjs/config';

const WELCOME_TEXT =
  'Добро пожаловать в <b>НеМалика</b> 👋\n\n' +
  'Чтобы продавать технику на платформе, поделитесь, пожалуйста, номером телефона — ' +
  'нажмите кнопку ниже.';

const CONTACT_SAVED_TEXT =
  'Спасибо! Номер телефона сохранён ✅\n' +
  'Теперь вы можете вернуться в приложение и создать свой первый магазин.';

const CONTACT_MISMATCH_TEXT =
  'Пожалуйста, поделитесь <b>своим собственным</b> номером телефона через кнопку ниже.';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly telegramApi: TelegramApiService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const webhookUrl = this.configService.get<string>('telegram.webhookUrl');
    const webhookSecret = this.configService.get<string>(
      'telegram.webhookSecret',
    );

    if (!webhookUrl) {
      this.logger.warn(
        'TELEGRAM_WEBHOOK_URL не задан — вебхук не регистрируется автоматически',
      );
      return;
    }

    await this.telegramApi.setWebhook(webhookUrl, webhookSecret);
    this.logger.log(`Telegram webhook зарегистрирован: ${webhookUrl}`);
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return; // игнорируем не-message апдейты (MVP не обрабатывает остальное)

    if (message.contact) {
      return this.handleContact(message);
    }

    if (message.text === '/start') {
      return this.handleStart(message);
    }

    // Любой другой текст — мягкая заглушка, без сложной логики диалога в MVP
    await this.telegramApi.sendMessage(
      message.chat.id,
      'Не понимаю эту команду. Отправьте /start, чтобы начать.',
    );
  }

  private async handleStart(message: TelegramMessage): Promise<void> {
    await this.telegramApi.requestContact(message.chat.id, WELCOME_TEXT);
  }

  private async handleContact(message: TelegramMessage): Promise<void> {
    const contact = message.contact!;

    // Защита от передачи чужого контакта: Telegram-кнопка request_contact
    // всегда шлёт контакт отправителя, но если контакт прислан вручную
    // (например, форвардом карточки), user_id может отличаться от from.id.
    if (contact.user_id && contact.user_id !== message.from.id) {
      await this.telegramApi.sendMessage(
        message.chat.id,
        CONTACT_MISMATCH_TEXT,
      );
      return;
    }

    const fullname =
      [message.from.first_name, message.from.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Без имени';

    try {
      await this.usersRepository.upsertFromBotContact({
        telegramId: message.from.id,
        telegramChatId: message.chat.id,
        phoneNumber: contact.phone_number,
        fullname,
        telegramUsername: message.from.username,
      });
    } catch (err) {
      this.logger.error(
        'Не удалось сохранить контакт пользователя',
        err as Error,
      );
      await this.telegramApi.sendMessage(
        message.chat.id,
        'Произошла ошибка при сохранении номера. Попробуйте ещё раз позже.',
      );
      return;
    }

    await this.telegramApi.removeKeyboard(message.chat.id, CONTACT_SAVED_TEXT);
  }
}
