import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { categories, type Category } from '../../db/schema';

@Injectable()
export class CategoriesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Всё дерево одним запросом: категорий сотня, разбивать по уровням незачем. */
  findAll(): Promise<Category[]> {
    return this.db
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.nameRu));
  }

  findById(id: number): Promise<Category | undefined> {
    return this.db.query.categories.findFirst({
      where: eq(categories.id, id),
    });
  }

  /** Корень ищется по slug отдельно: у листьев slug уникален лишь внутри родителя. */
  findRootBySlug(slug: string): Promise<Category | undefined> {
    return this.db.query.categories.findFirst({
      where: sql`${categories.slug} = ${slug} AND ${categories.parentId} IS NULL`,
    });
  }

  /**
   * Категория и все её потомки. Нужна фильтрации каталога: выбрав «Ноутбуки»,
   * покупатель ждёт и товары из «Игровых», а не пустую выдачу.
   */
  async findSubtreeIds(id: number): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
      )
      SELECT id FROM subtree
    `);
    return rows.rows.map((r) => Number(r.id));
  }

  /** Категории верхнего уровня — для витрины и меню каталога. */
  findRoots(): Promise<Category[]> {
    return this.db
      .select()
      .from(categories)
      .where(or(isNull(categories.parentId)))
      .orderBy(asc(categories.position));
  }
}
