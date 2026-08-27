import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { categories, type Category } from '../../db/schema';

@Injectable()
export class CategoriesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

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

  findRootBySlug(slug: string): Promise<Category | undefined> {
    return this.db.query.categories.findFirst({
      where: and(eq(categories.slug, slug), isNull(categories.parentId)),
    });
  }

  async findRootOf(id: number): Promise<Category | undefined> {
    const rows = await this.db.execute<{ id: number }>(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.parent_id
        FROM categories c JOIN ancestors a ON c.id = a.parent_id
      )
      SELECT id FROM ancestors WHERE parent_id IS NULL LIMIT 1
    `);
    const rootId = rows.rows[0]?.id;
    return rootId === undefined ? undefined : this.findById(Number(rootId));
  }

  async isRestricted(id: number): Promise<boolean> {
    const rows = await this.db.execute<{ restricted: boolean }>(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, restricted FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.parent_id, c.restricted
        FROM categories c JOIN ancestors a ON c.id = a.parent_id
      )
      SELECT true AS restricted FROM ancestors WHERE restricted LIMIT 1
    `);
    return rows.rows.length > 0;
  }

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
}
