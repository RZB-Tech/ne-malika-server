import { Injectable, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { UsersRepository } from './users.repository';
import { TelegramUserPayload } from '../auth/telegram-signature.util';
import { User } from '../../db/schema';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findById(id: number) {
    return this.usersRepository.findById(id);
  }

  async listForAdmin(query: PaginationQueryDto) {
    const { data, total, page, limit } =
      await this.usersRepository.findAllForAdmin(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getForAdmin(id: number) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    const recentProducts = await this.usersRepository.findRecentActivity(id);
    return { ...user, recentProducts };
  }

  async setRole(id: number, role: 'seller' | 'admin') {
    await this.getForAdmin(id);
    return this.usersRepository.setRole(id, role);
  }

  /** reason === null снимает блокировку. */
  async setBlocked(id: number, reason: string | null) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return this.usersRepository.setBlocked(id, reason);
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
