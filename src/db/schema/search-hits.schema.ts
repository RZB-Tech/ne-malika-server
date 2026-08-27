import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  varchar,
} from 'drizzle-orm/pg-core';
import { shops } from './shops.schema';

/**
 * По каким запросам находят товары магазина — суточный агрегат.
 *
 * Устроено как `product_stats_daily`, и по той же причине: журнал каждого
 * поиска рос бы неограниченно и всё равно требовал бы свёртки для отчёта,
 * поэтому свёртка делается на записи через
 * `INSERT ... ON CONFLICT DO UPDATE SET shows = shows + 1`.
 *
 * Строка пишется на магазин, а не на площадку: отчёт нужен продавцу и звучит
 * как «по каким словам вас нашли». Общеплощадочная статистика (в том числе
 * запросы с нулевой выдачей — самые ценные для администратора) сюда не
 * ложится: у неё нет магазина. Заводить её сейчас не будем — это вторая
 * таблица ради отчёта, которого никто не заказывал.
 *
 * `query` — нормализованная строка: нижний регистр, схлопнутые пробелы,
 * обрезка до 100 символов. Без нормализации «Ноутбук » и «ноутбук» были бы
 * двумя разными строками отчёта.
 */
export const shopSearchHitsDaily = pgTable(
  'shop_search_hits_daily',
  {
    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    /** Сутки по Ташкенту — те же, что у product_stats_daily. */
    day: date('day').notNull(),

    query: varchar('query', { length: 100 }).notNull(),

    /** Сколько раз товар магазина попал в выдачу по этому запросу. */
    shows: integer('shows').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.shopId, table.day, table.query] }),

    /**
     * Топ запросов магазина за период — ведущий столбец тот же, что в PK, но
     * без `query` в хвосте: отчёт всегда режет по магазину и диапазону дней, а
     * первичный ключ для такого range-скана тащит с собой третий столбец зря.
     */
    shopDayIdx: index('shop_search_hits_shop_day_idx').on(
      table.shopId,
      table.day,
    ),
  }),
);

export type ShopSearchHitsDaily = typeof shopSearchHitsDaily.$inferSelect;
export type NewShopSearchHitsDaily = typeof shopSearchHitsDaily.$inferInsert;
