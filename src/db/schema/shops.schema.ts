import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { entityStatusEnum } from './enums';

export interface WorkScheduleEntry {
  day: 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';
  start: string; // "09:00"
  end: string; // "18:00"
  isHoliday: boolean;
}

export const shops = pgTable(
  'shops',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    owner: bigint('owner', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    photo: uuid('photo'),

    telegramLink: varchar('telegram_link', { length: 255 }).notNull(),
    contact: varchar('contact', { length: 20 }).notNull(),

    /**
     * Кредиты на ИИ-генерацию. 1000 кредитов = $1 фактического расхода у
     * OpenRouter; целое число, потому что доли цента при тысячах операций
     * копят ошибку округления.
     */
    creditsBalance: bigint('credits_balance', { mode: 'number' })
      .notNull()
      .default(0),

    /** Занято под выполняющиеся запросы — освобождается после списания. */
    creditsReserved: bigint('credits_reserved', { mode: 'number' })
      .notNull()
      .default(0),

    /**
     * Оценка продавца. Считается по всем опубликованным отзывам, привязанным к
     * магазину, — и о нём самом, и о его товарах: покупатель судит о продавце
     * по товарам, а отдельный отзыв «о магазине» пишут единицы.
     */
    ratingAvg: doublePrecision('rating_avg').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),

    address: varchar('address', { length: 500 }),
    workSchedule: jsonb('work_schedule').$type<WorkScheduleEntry[]>(),
    /** [latitude, longitude] */
    location: doublePrecision('location').array(),

    status: entityStatusEnum('status').notNull().default('active'),
    abolishReason: text('abolish_reason'),
    abolishedAt: timestamp('abolished_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerUniqueIdx: uniqueIndex('shops_owner_unique_idx').on(table.owner),
    statusIdx: index('shops_status_idx').on(table.status),
  }),
);

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
