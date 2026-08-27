import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import { NewReport, reports } from '../../db/schema';
import { FindReportsQueryDto } from './dto/find-reports-query.dto';

@Injectable()
export class ReportsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewReport) {
    return this.db
      .insert(reports)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findById(id: number) {
    return this.db.query.reports.findFirst({ where: eq(reports.id, id) });
  }

  delete(id: number) {
    return this.db.delete(reports).where(eq(reports.id, id));
  }

  async findAll(query: FindReportsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const conditions: SQL[] = [];
    if (query.shop_id) conditions.push(eq(reports.shopId, query.shop_id));
    if (query.product_card_id) {
      conditions.push(eq(reports.productCardId, query.product_card_id));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, totalRows] = await Promise.all([
      this.db.query.reports.findMany({
        where,
        orderBy: desc(reports.createdAt),
        limit,
        offset,
        with: {
          shop: { columns: { id: true, name: true } },
          productCard: { columns: { id: true, name: true } },
        },
      }),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(reports)
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }
}
