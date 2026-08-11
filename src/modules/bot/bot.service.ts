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

const NOTIFICATIONS_ON_TEXT =
  'Уведомления включены ✅\nБудем присылать важное по вашему магазину. Отключить — /stop';

const NOTIFICATIONS_OFF_TEXT =
  'Уведомления отключены. Включить обратно — /start';

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

    const result = await this.telegramApi.setWebhook(webhookUrl, webhookSecret);
    if (!result.ok) {
      this.logger.error(
        `Telegram отклонил регистрацию вебхука ${webhookUrl}: ` +
          `${result.description ?? 'причина не указана'}. Бот не получит апдейты.`,
      );
      return;
    }
    this.logger.log(`Telegram webhook зарегистрирован: ${webhookUrl}`);
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return; // игнорируем не-message апдейты (MVP не обрабатывает остальное)

    if (message.chat.type !== 'private') return;

    if (message.contact) {
      return this.handleContact(message);
    }

    const command = parseCommand(message.text);

    if (command === '/start') {
      return this.handleStart(message);
    }

    if (command === '/stop') {
      return this.handleStop(message);
    }

    await this.telegramApi.sendMessage(
      message.chat.id,
      'Не понимаю эту команду. Отправьте /start, чтобы начать.',
    );
  }

  /**
   * Главное здесь — привязать чат. Раньше это происходило только после того,
   * как человек поделится номером, и до тех пор бот не мог написать ему ни
   * строчки: чата попросту не существовало.
   *
   * Тем, кто уже зарегистрирован на сайте, номер повторно не нужен — им сразу
   * подтверждаем, что уведомления включены.
   */
  private async handleStart(message: TelegramMessage): Promise<void> {
    const bound = await this.usersRepository
      .bindChat(message.from.id, message.chat.id)
      .catch((err: unknown) => {
        this.logger.error('Не удалось привязать чат', err as Error);
        return false;
      });

    if (bound) {
      await this.telegramApi.sendMessage(
        message.chat.id,
        NOTIFICATIONS_ON_TEXT,
      );
      return;
    }

    await this.telegramApi.requestContact(message.chat.id, WELCOME_TEXT);
  }

  /**
   * Отписка. Telegram требует, чтобы отключить рассылку можно было из самого
   * чата, а не только в личном кабинете.
   */
  private async handleStop(message: TelegramMessage): Promise<void> {
    await this.usersRepository.setNotificationsByTelegramId(
      message.from.id,
      false,
    );
    await this.telegramApi.sendMessage(message.chat.id, NOTIFICATIONS_OFF_TEXT);
  }

  private async handleContact(message: TelegramMessage): Promise<void> {
    const contact = message.contact!;

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

/**
 * Команда из текста сообщения.
 *
 * Раньше проверка была `startsWith('/start')`, и под неё подходило всё подряд —
 * от `/startup` до `/start_whatever`. Telegram к тому же дописывает к команде
 * имя бота (`/start@nemalika_bot`), поэтому строгое сравнение без обрезки
 * суффикса тоже не годится.
 *
 * Возвращает `null`, если это не команда.
 */
function parseCommand(text: string | undefined): string | null {
  const first = text?.trim().split(/\s+/)[0];
  if (!first?.startsWith('/')) return null;
  return first.split('@')[0].toLowerCase();
}
