import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { NewUser, User, users } from '../../db/schema';

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  findByTelegramId(telegramId: number): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.telegramId, telegramId),
    });
  }

  findById(id: number): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
  }

  create(data: NewUser): Promise<User> {
    return this.db
      .insert(users)
      .values(data)
      .returning()
      .then((rows) => rows[0]);
  }

  updateProfileFromTelegram(
    id: number,
    data: Pick<NewUser, 'telegramUsername' | 'telegramPhoto' | 'fullname'>,
  ): Promise<User> {
    return this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
      .then((rows) => rows[0]);
  }

  /** Вызывается BotModule после получения контакта через request_contact. */
  updateContactInfo(
    telegramId: number,
    data: { phoneNumber: string; telegramChatId: number },
  ): Promise<User> {
    return this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.telegramId, telegramId))
      .returning()
      .then((rows) => rows[0]);
  }

  async upsertFromBotContact(data: {
    telegramId: number;
    telegramChatId: number;
    phoneNumber: string;
    fullname: string;
    telegramUsername?: string;
  }): Promise<User> {
    const existing = await this.findByTelegramId(data.telegramId);

    if (existing) {
      return this.db
        .update(users)
        .set({
          phoneNumber: data.phoneNumber,
          telegramChatId: data.telegramChatId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning()
        .then((rows) => rows[0]);
    }

    return this.create({
      telegramId: data.telegramId,
      telegramChatId: data.telegramChatId,
      telegramUsername: data.telegramUsername,
      phoneNumber: data.phoneNumber,
      fullname: data.fullname,
      role: 'seller',
    });
  }
}
