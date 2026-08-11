import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';

/**
 * Что нарисовал ИИ по фотографии товара.
 *
 * Сами картинки лежат в S3 сразу после генерации — терялись не они, а ссылки
 * на них: диалог держал результат в состоянии React и обнулял его при
 * закрытии. Эта таблица и есть недостающая память.
 *
 * Заодно она считает расход квоты: «использовано» — это число строк, а не
 * отдельный счётчик, который рано или поздно разъедется с реальностью.
 *
 * Автор — ON DELETE SET NULL: удаление пользователя не должно стирать
 * картинки, которые уже стоят в карточках товаров.
 */
export const generatedImages = pgTable(
  'generated_images',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Фото, по которому рисовали — по нему галерея и открывается. */
    sourceKey: uuid('source_key').notNull(),

    /** Ключ готовой картинки в S3. */
    key: uuid('key').notNull(),

    prompt: text('prompt').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceKeyIdx: index('generated_images_source_key_idx').on(
      table.sourceKey,
      sql`${table.createdAt} DESC`,
    ),
    userIdIdx: index('generated_images_user_id_idx').on(table.userId),
  }),
);

export type GeneratedImage = typeof generatedImages.$inferSelect;
export type NewGeneratedImage = typeof generatedImages.$inferInsert;
