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
     * Тариф магазина. Сам по себе прав не даёт: «подписка жива» — это
     * `plan <> 'free'` И `subscription_until > now()`, и обе половины
     * проверяются вместе (`src/db/subscriptions.ts`). Просроченный платный
     * тариф остаётся здесь до следующей оплаты — так видно, чем магазин
     * пользовался, и не нужна задача, которая переводила бы его в `free`.
     */
    subscriptionPlan: subscriptionPlanEnum('subscription_plan')
      .notNull()
      .default('free'),

    /**
     * До какого момента оплачено. Пусто у тех, кто ни разу не платил.
     * Момент, а не дата: продление в середине дня не должно ни отнимать у
     * продавца часы, ни дарить их.
     *
     * Денормализованный кэш максимального `activated_until` среди платежей со
     * статусом `paid` — источник правды там, а читается это на каждом действии
     * продавца и в каждом запросе витрины.
     */
    subscriptionUntil: timestamp('subscription_until', { withTimezone: true }),

    /**
     * Кредиты, выданные подпиской. Отдельно от `credits_balance`, потому что
     * живут по другим правилам: купленные и подаренные не сгорают никогда,
     * подписочные обнуляются при выдаче следующего периода. Одной колонкой их
     * не свести — при сгорании пришлось бы вычитать «сколько там было
     * подписочного», а из суммы это уже не узнать.
     *
     * Истёкшая подписка их не обнуляет: они просто перестают быть доступными
     * к трате (`USABLE_SUBSCRIPTION_CREDITS`). Оплатил снова — увидел ровно ту
     * норму, что положена тарифу, а не остатки прошлой.
     *
     * Тратятся первыми: иначе к концу месяца сгорело бы то, за что человек
     * заплатил отдельно.
     */
    subscriptionCredits: bigint('subscription_credits', { mode: 'number' })
      .notNull()
      .default(0),

    /**
     * Сколько бесплатных автозаполнений магазин израсходовал в текущем месяце.
     *
     * Счётчиком, а не `COUNT(*)` по `ai_usage`: форма товара спрашивает
     * остаток до каждого нажатия кнопки, а главное — `AiUsageService.record`
     * намеренно глотает ошибку записи, и журнал, из которого пропала строка,
     * молча подарил бы магазину лишнюю попытку.
     */
    autofillFreeUsed: integer('autofill_free_used').notNull().default(0),

    /**
     * Месяц-якорь счётчика: первое число календарного месяца по Ташкенту, за
     * который он посчитан.
     *
     * Нужен, чтобы обнулять счётчик лениво, при первом обращении в новом
     * месяце (`period <> текущий` → счётчик пишется единицей вместе с якорем),
     * а не заданием по расписанию: задание гоняло бы все магазины ради строки,
     * которую большинство из них в этом месяце не откроет, и молча ломалось бы
     * при простое сервиса.
     *
     * Оплата якорь не трогает: норма привязана к календарю, а не к дате
     * платежа, — так решено в тарифах, и так проще объяснить продавцу.
     */
    autofillPeriodMonth: date('autofill_period_month'),

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

    /**
     * Разрешение выкладывать товар в закрытые разделы каталога
     * (`categories.restricted` — сейчас это «Смартфоны» и «Планшеты»).
     *
     * Одно на все закрытые разделы: администратор решает про магазин целиком —
     * «этому продавцу мобильную технику можно», — а не отмечает галочки по
     * разделам. Понадобится раздавать поштучно — здесь появится таблица связи,
     * а проверка в коде уже спрашивает «можно ли этому магазину эту категорию».
     */
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

    /**
     * Для админского списка подписок и для напоминаний об истечении: обе
     * выборки ищут по `subscription_until` среди платных, а таких строк
     * меньшинство — индекс частичный, чтобы не тащить в него весь бесплатный
     * хвост. Витрине он не нужен: там порядок и так считается перебором.
     */
    subscriptionUntilIdx: index('shops_subscription_until_idx')
      .on(table.subscriptionUntil)
      .where(sql`${table.subscriptionUntil} IS NOT NULL`),
  }),
);

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
