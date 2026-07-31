import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { appSettings } from '../../db/schema';

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(appSettings.key, key),
    });
    return row?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
