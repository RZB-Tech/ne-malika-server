import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { NewShop, Shop, productCards, shops } from '../../db/schema';

@Injectable()
export class ShopsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewShop): Promise<Shop> {
    return this.db
      .insert(shops)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findByOwner(ownerId: number): Promise<Shop[]> {
    return this.db
      .select()
      .from(shops)
      .where(eq(shops.owner, ownerId))
      .orderBy(desc(shops.createdAt));
  }

  findFirstByOwner(ownerId: number): Promise<Shop | undefined> {
    return this.db.query.shops.findFirst({
      where: eq(shops.owner, ownerId),
    });
  }

  findById(id: number): Promise<Shop | undefined> {
    return this.db.query.shops.findFirst({ where: eq(shops.id, id) });
  }

  findOwnedByIdAndOwner(
    id: number,
    ownerId: number,
  ): Promise<Shop | undefined> {
    return this.db.query.shops.findFirst({
      where: and(eq(shops.id, id), eq(shops.owner, ownerId)),
    });
  }

  /** Публичная карточка магазина: только активный магазин + его активные товары. */
  findPublicById(id: number) {
    return this.db.query.shops.findFirst({
      where: and(eq(shops.id, id), eq(shops.status, 'active')),
      with: {
        productCards: {
          where: eq(productCards.status, 'active'),
          orderBy: desc(productCards.createdAt),
        },
      },
    });
  }

  update(id: number, data: Partial<NewShop>): Promise<Shop> {
    return this.db
      .update(shops)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shops.id, id))
      .returning()
      .then((r) => r[0]);
  }

  delete(id: number): Promise<void> {
    return this.db
      .delete(shops)
      .where(eq(shops.id, id))
      .then(() => undefined);
  }

  abolish(id: number, reason: string): Promise<Shop> {
    return this.db
      .update(shops)
      .set({
        status: 'abolished',
        abolishReason: reason,
        abolishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, id))
      .returning()
      .then((r) => r[0]);
  }
}
