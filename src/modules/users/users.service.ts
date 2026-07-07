import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { TelegramUserPayload } from '../auth/telegram-init-data.util';
import { User } from '../../db/schema';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findById(id: number) {
    return this.usersRepository.findById(id);
  }

  /**
   * Возвращает существующего пользователя либо создаёт нового по данным initData.
   * phone_number/telegram_chat_id на этом шаге ещё не известны — их пришлёт
   * BotModule после того, как пользователь поделится контактом через кнопку
   * request_contact (см. раздел 4.2, шаг 4).
   */
  async findOrCreateFromTelegram(payload: TelegramUserPayload): Promise<User> {
    const existing = await this.usersRepository.findByTelegramId(payload.id);
    if (existing) {
      // Обновляем «мягкие» поля из Telegram на каждый вход — они могут меняться
      return this.usersRepository.updateProfileFromTelegram(existing.id, {
        telegramUsername: payload.username ?? existing.telegramUsername,
        telegramPhoto: payload.photo_url ?? existing.telegramPhoto,
        fullname: existing.fullname,
      });
    }

    const fullname =
      [payload.first_name, payload.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Без имени';

    return this.usersRepository.create({
      telegramId: payload.id,
      telegramUsername: payload.username,
      telegramPhoto: payload.photo_url,
      fullname,
      role: 'seller', // по умолчанию — продавец; admin назначается вручную (раздел 3.1)
    });
  }
}
