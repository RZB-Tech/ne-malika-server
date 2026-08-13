import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { type CreditTxnMeta, creditTransactions, shops } from '../../db/schema';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';

export interface ShopCredits {
  balance: number;
  reserved: number;
}

@Injectable()
export class CreditsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async find(shopId: number): Promise<ShopCredits | undefined> {
    const rows = await this.db
      .select({
        balance: shops.creditsBalance,
        reserved: shops.creditsReserved,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return rows[0];
  }

  /** Магазин продавца. Кредиты живут у магазина, а запрос делает его владелец. */
  async findShopIdByOwner(ownerId: number): Promise<number | undefined> {
    const rows = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0]?.id;
  }

  /**
   * Занимает кредиты под запрос одним UPDATE.
   *
   * Условие проверяется тем же оператором, который меняет счётчик: два
   * параллельных запроса не могут оба увидеть свободный остаток — Postgres
   * сериализует их на блокировке строки. Возвращает false, если не хватает.
   */
  async reserve(shopId: number, credits: number): Promise<boolean> {
    const rows = await this.db
      .update(shops)
      .set({ creditsReserved: sql`${shops.creditsReserved} + ${credits}` })
      .where(
        and(
          eq(shops.id, shopId),
          sql`${shops.creditsBalance} - ${shops.creditsReserved} >= ${credits}`,
        ),
      )
      .returning({ id: shops.id });
    return rows.length > 0;
  }

  /** Снимает резерв, не трогая баланс. */
  async release(shopId: number, credits: number): Promise<void> {
    await this.db
      .update(shops)
      .set({
        creditsReserved: sql`greatest(0, ${shops.creditsReserved} - ${credits})`,
      })
      .where(eq(shops.id, shopId));
  }

  /**
   * Списание по факту: снимает резерв и уменьшает баланс одной транзакцией,
   * тут же записывая строку в журнал. Иначе при сбое между двумя запросами
   * баланс и история разошлись бы, а разобрать это потом нечем.
   *
   * `greatest(0, ...)` у баланса — защита от ухода в минус: фактическая
   * стоимость может немного превысить резерв, и уйти ниже нуля нельзя.
   */
  async spend(
    shopId: number,
    reserved: number,
    credits: number,
    meta: CreditTxnMeta,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(shops)
        .set({
          creditsReserved: sql`greatest(0, ${shops.creditsReserved} - ${reserved})`,
          creditsBalance: sql`greatest(0, ${shops.creditsBalance} - ${credits})`,
        })
        .where(eq(shops.id, shopId))
        .returning({ balance: shops.creditsBalance });

      const balanceAfter = rows[0]?.balance ?? 0;

      if (credits > 0) {
        await tx.insert(creditTransactions).values({
          shopId,
          kind: 'spend',
          amount: -credits,
          balanceAfter,
          meta,
        });
      }

      return balanceAfter;
    });
  }

  /**
   * Выдача кредитов. `authorId` бывает пустым: приветственные начисляет
   * система, а не человек, и подставлять туда администратора значило бы врать
   * в журнале — колонка на этот случай и объявлена nullable.
   */
  async grant(data: {
    shopId: number;
    authorId: number | null;
    credits: number;
    note?: string;
    meta: CreditTxnMeta;
  }): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(shops)
        .set({
          creditsBalance: sql`${shops.creditsBalance} + ${data.credits}`,
        })
        .where(eq(shops.id, data.shopId))
        .returning({ balance: shops.creditsBalance });

      const balanceAfter = rows[0]?.balance ?? 0;

      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: data.authorId,
        kind: 'grant',
        amount: data.credits,
        balanceAfter,
        note: data.note,
        meta: data.meta,
      });

      return balanceAfter;
    });
  }

  /**
   * Получал ли магазин выдачу по этой акции. Проверяется по журналу, а не по
   * флагу в магазине: журнал и так источник правды по деньгам, а лишняя
   * колонка разъехалась бы с ним при первом же ручном исправлении баланса.
   */
  async hasPromo(shopId: number, promo: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.shopId, shopId),
          sql`${creditTransactions.meta}->>'promo' = ${promo}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Отобрать кредиты.
   *
   * Снимаем только из доступного: часть баланса бывает занята выполняющимся
   * сейчас запросом, и забрать её значило бы оборвать чужую генерацию на
   * полпути. Поэтому же строка магазина блокируется до конца транзакции —
   * иначе параллельное списание посчитало бы доступное по-своему.
   *
   * Возвращаем реально снятое: администратор мог запросить больше, чем есть, и
   * сказать ему об этом честнее, чем молча снять сколько получилось.
   */
  async revoke(data: {
    shopId: number;
    authorId: number;
    credits: number;
    note?: string;
  }): Promise<{ taken: number; balance: number }> {
    return this.db.transaction(async (tx) => {
      const current = await tx
        .select({
          balance: shops.creditsBalance,
          reserved: shops.creditsReserved,
        })
        .from(shops)
        .where(eq(shops.id, data.shopId))
        .for('update');

      const balance = current[0]?.balance ?? 0;
      const available = Math.max(0, balance - (current[0]?.reserved ?? 0));
      const taken = Math.min(data.credits, available);
      if (taken === 0) return { taken: 0, balance };

      const rows = await tx
        .update(shops)
        .set({ creditsBalance: sql`${shops.creditsBalance} - ${taken}` })
        .where(eq(shops.id, data.shopId))
        .returning({ balance: shops.creditsBalance });

      const balanceAfter = rows[0]?.balance ?? 0;

      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: data.authorId,
        kind: 'adjust',
        amount: -taken,
        balanceAfter,
        note: data.note,
      });

      return { taken, balance: balanceAfter };
    });
  }

  async history(shopId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const data = await this.db
      .select({
        id: creditTransactions.id,
        kind: creditTransactions.kind,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        note: creditTransactions.note,
        meta: creditTransactions.meta,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.shopId, shopId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.shopId, shopId))
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }
}
