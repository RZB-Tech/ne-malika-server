import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
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

  async findAll(query: FindReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (query.shop_id) conditions.push(eq(reports.shopId, query.shop_id));
    if (query.product_card_id) {
      conditions.push(eq(reports.productCardId, query.product_card_id));
    }
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [data, totalRows] = await Promise.all([
      this.db.query.reports.findMany({
        where: whereClause,
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
        .where(whereClause),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }
}
