import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Дерево категорий каталога. Глубина не ограничена схемой, но наполнение —
 * два уровня: корень («Ноутбуки») и лист («Игровые»).
 *
 * Названия хранятся тремя колонками, а не переводом на лету: список читается
 * на каждой странице каталога, а языков ровно три и новые не планируются.
 */
export const categories = pgTable(
  'categories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    parentId: bigint('parent_id', { mode: 'number' }).references(
      (): AnyPgColumn => categories.id,
      { onDelete: 'cascade' },
    ),

    slug: varchar('slug', { length: 80 }).notNull(),

    nameRu: varchar('name_ru', { length: 120 }).notNull(),
    nameUzLatn: varchar('name_uz_latn', { length: 120 }).notNull(),
    nameUzCyrl: varchar('name_uz_cyrl', { length: 120 }).notNull(),

    /** Имя иконки lucide — клиент рисует ею плитку категории. Только у корней. */
    icon: varchar('icon', { length: 40 }),

    position: integer('position').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    parentIdIdx: index('categories_parent_id_idx').on(table.parentId),

    // Slug уникален только внутри родителя: «gaming» встречается и у ноутбуков,
    // и у мышей. Для корней NULL в parent_id не даёт обычному UNIQUE сработать,
    // поэтому им нужен отдельный частичный индекс.
    childSlugIdx: uniqueIndex('categories_parent_slug_idx').on(
      table.parentId,
      table.slug,
    ),
    rootSlugIdx: uniqueIndex('categories_root_slug_idx')
      .on(table.slug)
      .where(sql`${table.parentId} IS NULL`),
  }),
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
