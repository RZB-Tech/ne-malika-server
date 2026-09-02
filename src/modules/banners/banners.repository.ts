import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { banners, shops, type NewBanner } from '../../db/schema';
import { SUBSCRIPTION_ACTIVE } from '../../db/subscriptions';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import { MAX_ACTIVE_BANNERS } from './banners.constants';
import { FindShopBannersQueryDto } from './dto/find-shop-banners-query.dto';

const PUBLIC_COLUMNS = {
  id: banners.id,
  title: banners.title,
  photoRu: banners.photoRu,
  photoUzLatn: banners.photoUzLatn,
  linkUrl: banners.linkUrl,
} as const;

const BANNER_COLUMNS = {
  ...PUBLIC_COLUMNS,
  isActive: banners.isActive,
  expiresAt: banners.expiresAt,
  sortOrder: banners.sortOrder,
  shopId: banners.shopId,
  status: banners.status,
  rejectReason: banners.rejectReason,
  moderatedAt: banners.moderatedAt,
  createdAt: banners.createdAt,
  updatedAt: banners.updatedAt,
} as const;

const NOT_EXPIRED = sql`(${banners.expiresAt} is null or ${banners.expiresAt} > now())`;

@Injectable()
export class BannersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  findActivePlatform(limit: number = MAX_ACTIVE_BANNERS) {
    return this.db
      .select(PUBLIC_COLUMNS)
      .from(banners)
      .where(
        and(
          isNull(banners.shopId),
          eq(banners.isActive, true),
          eq(banners.status, 'approved'),
          NOT_EXPIRED,
        ),
      )
      .orderBy(asc(banners.sortOrder), asc(banners.id))
      .limit(limit);
  }

  findActiveShop(bucket: string, limit: number) {
    return this.db
      .select(PUBLIC_COLUMNS)
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(
        and(
          eq(banners.isActive, true),
          eq(banners.status, 'approved'),
          NOT_EXPIRED,
          eq(shops.status, 'active'),
          eq(shops.subscriptionPlan, 'max'),
          SUBSCRIPTION_ACTIVE,
        ),
      )
      .orderBy(sql`md5(${bucket} || ${banners.id}::text)`)
      .limit(limit);
  }

  findAll() {
    return this.db
      .select(BANNER_COLUMNS)
      .from(banners)
      .where(isNull(banners.shopId))
      .orderBy(asc(banners.sortOrder), asc(banners.id));
  }

  findById(id: number) {
    return this.db.query.banners.findFirst({ where: eq(banners.id, id) });
  }

  findOwned(shopId: number) {
    return this.db
      .select(BANNER_COLUMNS)
      .from(banners)
      .where(eq(banners.shopId, shopId))
      .orderBy(desc(banners.createdAt));
  }

  findOwnedByIdAndShop(id: number, shopId: number) {
    return this.db
      .select(BANNER_COLUMNS)
      .from(banners)
      .where(and(eq(banners.id, id), eq(banners.shopId, shopId)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  async countOwned(shopId: number): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(banners)
      .where(eq(banners.shopId, shopId));
    return rows[0]?.count ?? 0;
  }

  async findShopBanners(query: FindShopBannersQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const where = and(
      query.status ? eq(banners.status, query.status) : undefined,
      query.shop_id ? eq(banners.shopId, query.shop_id) : undefined,
    );

    const data = await this.db
      .select({ ...BANNER_COLUMNS, shopName: shops.name })
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(where)
      .orderBy(desc(banners.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(where);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  findShopBannerById(id: number) {
    return this.db
      .select({
        ...BANNER_COLUMNS,
        shopName: shops.name,
        shopOwner: shops.owner,
      })
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(eq(banners.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }

  create(data: NewBanner) {
    return this.db
      .insert(banners)
      .values(data)
      .returning(BANNER_COLUMNS)
      .then((r) => r[0]);
  }

  update(id: number, data: Partial<NewBanner>) {
    return this.db
      .update(banners)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(banners.id, id))
      .returning(BANNER_COLUMNS)
      .then((r) => r[0]);
  }

  delete(id: number) {
    return this.db.delete(banners).where(eq(banners.id, id));
  }

  async maxSortOrder(): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number | null>`max(${banners.sortOrder})` })
      .from(banners)
      .where(isNull(banners.shopId));
    return rows[0]?.max ?? -1;
  }

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
