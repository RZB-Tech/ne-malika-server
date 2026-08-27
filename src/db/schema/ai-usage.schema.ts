import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.schema';
import { users } from './users.schema';

/**
 * Кто и для какого магазина обращался к ИИ.
 *
 * Отдельно от credit_transactions, хотя те тоже пишут расход. Причин две.
 * Во-первых, у списаний там не заполняется автор: журнал денег отвечает на
 * вопрос «сколько ушло у магазина», а не «кто нажал кнопку». Во-вторых,
 * администратор работает без списания — его запросы не создают транзакцию
 * вовсе, а платит за них площадка, и именно их важнее всего видеть.
 *
 * Обе ссылки — ON DELETE SET NULL: удаление продавца или магазина не должно
 * стирать запись о деньгах, которые площадка уже потратила.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Магазин, с которого списано. Пусто у администратора — платит площадка. */
    shopId: bigint('shop_id', { mode: 'number' }).references(() => shops.id, {
      onDelete: 'set null',
    }),

    /**
     * Что делали: prompt — составление промпта по фото, description — правка
     * описания, image — рисование картинок. Строкой, а не enum: журнал
     * пополнится проверкой товаров и сравнением, и каждый раз ходить в
     * миграцию ради нового значения незачем.
     */
    operation: varchar('operation', { length: 20 }).notNull(),

    model: varchar('model', { length: 120 }),

    /** Сколько картинок пришло — у остальных операций ноль. */
    images: integer('images').notNull().default(0),

    /** Фактическая стоимость у OpenRouter. Пусто, если он её не вернул. */
    usd: doublePrecision('usd'),

    /** Списано с магазина. Ноль у администратора и у бесплатных операций. */
    credits: bigint('credits', { mode: 'number' }).notNull().default(0),

    /**
     * Операция не стоила магазину ничего, хотя магазин у неё есть: месячная
     * норма START или безлимит PRO/MAX.
     *
     * Без этого признака `credits = 0` при непустом `shop_id` означал бы ровно
     * один случай — сбой списания (`CreditsService.settleFixed` в catch
     * возвращает 0), — и разобрать по журналу, что произошло, стало бы нечем.
     * Администратор различается по `shop_id IS NULL`, с ним пересечения нет.
     */
    free: boolean('free').notNull().default(false),

    /** Списано по оценке, потому что фактическая стоимость не пришла. */
    estimated: boolean('estimated').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /** Лента журнала — всегда свежим вперёд. */
    createdAtIdx: index('ai_usage_created_at_idx').on(
      sql`${table.createdAt} DESC`,
    ),
    shopIdIdx: index('ai_usage_shop_id_idx').on(
      table.shopId,
      sql`${table.createdAt} DESC`,
    ),
    userIdIdx: index('ai_usage_user_id_idx').on(
      table.userId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type NewAiUsage = typeof aiUsage.$inferInsert;
