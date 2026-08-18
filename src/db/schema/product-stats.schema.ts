import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { productCards } from './product-cards.schema';

/**
 * Статистика карточки товара по суткам: просмотры, уникальные посетители и
 * контакты с продавцом.
 *
 * Не журнал событий, а суточный агрегат — одна строка на пару «товар + день».
 * Журнал рос бы неограниченно (каждый заход анонима = строка) и всё равно
 * потребовал бы свёртки для графика, поэтому свёртка делается сразу, на записи:
 * `INSERT ... ON CONFLICT DO UPDATE SET views = views + EXCLUDED.views`.
 *
 * Ценой этого теряется детализация внутри суток — час, реферер, устройство.
 * Осознанный размен: продавцу нужен ответ «сколько и когда», а не «кто откуда»,
 * а тысяча товаров за год займёт здесь порядка 365 тысяч строк вместо десятков
 * миллионов.
 *
 * Отличать от `product_views`: та таблица — личная история покупателя («что я
 * смотрел»), одна строка на пару «пользователь + товар» с перезаписью времени.
 * Временного ряда из неё не собрать, и анонимов там нет вовсе.
 */
export const productStatsDaily = pgTable(
  'product_stats_daily',
  {
    productCardId: bigint('product_card_id', { mode: 'number' })
      .notNull()
      .references(() => productCards.id, { onDelete: 'cascade' }),

    /**
     * Сутки в часовом поясе площадки, а не в UTC: продавец в Ташкенте,
     * открыв график вечером, должен видеть сегодняшние просмотры сегодня,
     * а не размазанными по двум столбикам.
     */
    day: date('day').notNull(),

    /** Открытия карточки. Повторы одного посетителя схлопнуты окном в 30 минут. */
    views: integer('views').notNull().default(0),

    /** Уникальные посетители за сутки — считаются по одному разу на день. */
    visitors: integer('visitors').notNull().default(0),

    /** Раскрытия телефона продавца. */
    phoneClicks: integer('phone_clicks').notNull().default(0),

    /** Переходы в Telegram к продавцу. */
    telegramClicks: integer('telegram_clicks').notNull().default(0),

    /**
     * Уникальные посетители, дошедшие хотя бы до одного контакта за сутки.
     *
     * Отдельный счётчик, а не сумма двух предыдущих: один человек может и
     * раскрыть телефон, и уйти в Telegram, и в сумме посчитался бы дважды —
     * конверсия тогда способна перевалить за 100%. Здесь он считается один раз.
     */
    contactVisitors: integer('contact_visitors').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productCardId, table.day] }),

    /**
     * Для админских графиков: они группируют по дню поперёк всех товаров,
     * тогда как первичный ключ отсортирован сначала по товару и такому
     * запросу не помогает.
     */
    dayIdx: index('product_stats_daily_day_idx').on(table.day),
  }),
);

export type ProductStatsDaily = typeof productStatsDaily.$inferSelect;
export type NewProductStatsDaily = typeof productStatsDaily.$inferInsert;
