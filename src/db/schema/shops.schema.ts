import {
  bigint,
  bigserial,
  boolean,
  date,
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
import { sql } from 'drizzle-orm';
import { users } from './users.schema';
import { entityStatusEnum, subscriptionPlanEnum } from './enums';

export interface WorkScheduleEntry {
  day: 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';
  start: string;
  end: string;
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

    creditsBalance: bigint('credits_balance', { mode: 'number' })
      .notNull()
      .default(0),

    creditsReserved: bigint('credits_reserved', { mode: 'number' })
      .notNull()
      .default(0),

    subscriptionPlan: subscriptionPlanEnum('subscription_plan')
      .notNull()
      .default('free'),

    subscriptionUntil: timestamp('subscription_until', { withTimezone: true }),

    subscriptionCredits: bigint('subscription_credits', { mode: 'number' })
      .notNull()
      .default(0),

    autofillFreeUsed: integer('autofill_free_used').notNull().default(0),

    autofillPeriodMonth: date('autofill_period_month'),

    subscriptionTestUntil: timestamp('subscription_test_until', {
      withTimezone: true,
    }),

    ratingAvg: doublePrecision('rating_avg').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),

    address: varchar('address', { length: 500 }),
    workSchedule: jsonb('work_schedule').$type<WorkScheduleEntry[]>(),
    location: doublePrecision('location').array(),

    restrictedCategoriesEnabled: boolean('restricted_categories_enabled')
      .notNull()
      .default(false),

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

    subscriptionUntilIdx: index('shops_subscription_until_idx')
      .on(table.subscriptionUntil)
      .where(sql`${table.subscriptionUntil} IS NOT NULL`),
  }),
);

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
