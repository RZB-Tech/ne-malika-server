import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { moderationStatusEnum } from './enums';
import { shops } from './shops.schema';
import { users } from './users.schema';

/**
 * Баннер главной страницы — картинка-ссылка в карусели над каталогом.
 *
 * Фото хранится по одному на каждый язык интерфейса: текст акции нарисован
 * прямо на картинке, и русская плашка на узбекской версии сайта читалась бы
 * как недоделка. Ключи — те же uuid из S3, что у товаров и магазинов, поэтому
 * загрузка идёт через уже существующий presigned-эндпоинт без изменений.
 *
 * Здесь же живут платные баннеры продавцов с тарифа MAX — отдельной таблицы
 * `shop_banners` нет намеренно. Карусель на главной одна, порядок в ней один,
 * общий предел активных баннеров один, а публичный контракт `GET /banners`
 * клиент уже потребляет. Две таблицы означали бы `UNION ALL` с двумя разными
 * порядками, два DTO и две ветки в карусели на клиенте. Цена принятого
 * решения — четыре колонки, вечно пустые у площадочных строк; она меньше.
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

    /**
     * Чей баннер. Пусто — площадочный, заведён администратором: именно
     * nullable и делает миграцию безопасной, все существующие строки остаются
     * ровно тем, чем были. Каскад корректен для баннера магазина и площадочных
     * не задевает.
     */
    shopId: bigint('shop_id', { mode: 'number' }).references(() => shops.id, {
      onDelete: 'cascade',
    }),

    /**
     * Модерация. Значение по умолчанию `approved` — иначе накат миграции
     * уронил бы всю нынешнюю карусель в очередь на проверку. Продавцу
     * `pending` ставит код при создании, а не дефолт колонки.
     */
    status: moderationStatusEnum('status').notNull().default('approved'),

    /** Причина отказа — её читает продавец, поэтому пишется человеческим языком. */
    rejectReason: text('reject_reason'),

    /** Кто решил. `set null`: уход администратора не должен стирать баннер. */
    moderatedBy: bigint('moderated_by', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /**
     * Публичная выдача: только включённые и прошедшие модерацию, по порядку.
     * Частичный — потому что отклонённых и ждущих в карусели не бывает вовсе,
     * и держать их в индексе незачем.
     *
     * Заменяет прежний `banners_active_sort_idx`, а не дополняет его: там
     * ведущим столбцом был `is_active`, а он теперь целиком ушёл в условие
     * индекса, и от старого префикса не осталось смысла.
     *
     * `is_active` и `status` не слиты в одну колонку сознательно: первое —
     * «владелец включил», второе — «модерация пропустила», и витрине нужны
     * оба. В админке они тоже показываются раздельно, иначе отклонённый, но
     * включённый продавцом баннер выглядел бы ошибкой площадки.
     */
    publicIdx: index('banners_public_idx')
      .on(table.sortOrder, table.id)
      .where(sql`${table.isActive} AND ${table.status} = 'approved'`),

    /** Очередь модерации и список баннеров магазина в его кабинете. */
    shopStatusIdx: index('banners_shop_status_idx').on(
      table.shopId,
      table.status,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type Banner = typeof banners.$inferSelect;
export type NewBanner = typeof banners.$inferInsert;
