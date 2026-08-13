import {
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Баннер главной страницы — картинка-ссылка в карусели над каталогом.
 *
 * Фото хранится по одному на каждый язык интерфейса: текст акции нарисован
 * прямо на картинке, и русская плашка на узбекской версии сайта читалась бы
 * как недоделка. Ключи — те же uuid из S3, что у товаров и магазинов, поэтому
 * загрузка идёт через уже существующий presigned-эндпоинт без изменений.
 */
export const banners = pgTable(
  'banners',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    /** Имя для списка в админке; оно же уходит в alt изображения. */
    title: varchar('title', { length: 200 }).notNull(),

    photoRu: uuid('photo_ru').notNull(),
    photoUzLatn: uuid('photo_uz_latn').notNull(),
    photoUzCyrl: uuid('photo_uz_cyrl').notNull(),

    /** Куда ведёт клик. Пусто — баннер показывается, но не кликается. */
    linkUrl: varchar('link_url', { length: 500 }),

    isActive: boolean('is_active').notNull().default(true),

    /** Порядок в карусели: меньше — раньше. */
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /** Публичная выдача — всегда «активные по порядку»: ровно этот индекс. */
    activeSortIdx: index('banners_active_sort_idx').on(
      table.isActive,
      table.sortOrder,
    ),
  }),
);

export type Banner = typeof banners.$inferSelect;
export type NewBanner = typeof banners.$inferInsert;
