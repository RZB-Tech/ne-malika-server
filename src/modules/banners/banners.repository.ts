import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { banners, type NewBanner } from '../../db/schema';
import { MAX_ACTIVE_BANNERS } from './banners.constants';

@Injectable()
export class BannersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Витрина: только включённые, в заданном порядке, с потолком на длину. */
  findActive() {
    return this.db.query.banners.findMany({
      where: eq(banners.isActive, true),
      orderBy: [asc(banners.sortOrder), asc(banners.id)],
      limit: MAX_ACTIVE_BANNERS,
    });
  }

  /** Админка: все, включая выключенные, в том же порядке — список без листалки. */
  findAll() {
    return this.db.query.banners.findMany({
      orderBy: [asc(banners.sortOrder), asc(banners.id)],
    });
  }

  findById(id: number) {
    return this.db.query.banners.findFirst({ where: eq(banners.id, id) });
  }

  create(data: NewBanner) {
    return this.db
      .insert(banners)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  update(id: number, data: Partial<NewBanner>) {
    return this.db
      .update(banners)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(banners.id, id))
      .returning()
      .then((r) => r[0]);
  }

  delete(id: number) {
    return this.db.delete(banners).where(eq(banners.id, id));
  }

  /** Максимальный порядок — чтобы новый баннер вставал в конец карусели. */
  async maxSortOrder(): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number | null>`max(${banners.sortOrder})` })
      .from(banners);
    return rows[0]?.max ?? -1;
  }

  /**
   * Расставляет переданные id по позициям 0..n-1 одним запросом: CASE в SET
   * вместо цикла из апдейтов, иначе перестановка десяти баннеров — это десять
   * поездок в базу, каждая из которых может не доехать.
   */
  async applyOrder(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    const cases = sql.join(
      ids.map((id, i) => sql`when ${banners.id} = ${id} then ${i}`),
      sql` `,
    );

    await this.db
      .update(banners)
      .set({
        sortOrder: sql`case ${cases} else ${banners.sortOrder} end`,
        updatedAt: new Date(),
      })
      .where(inArray(banners.id, ids));
  }
}
