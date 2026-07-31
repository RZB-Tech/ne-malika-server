import { jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Настройки, которые администратор меняет из панели. Ключ-значение, потому что
 * настроек мало и они разнородные — отдельная колонка на каждую означала бы
 * миграцию на каждый переключатель.
 */
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
