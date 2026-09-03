import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb, type Tx } from '../../db/db.provider';
import {
  type CreditTxnMeta,
  creditTransactions,
  shops,
  subscriptionPayments,
} from '../../db/schema';
import {
  AVAILABLE_CREDITS,
  SUBSCRIPTION_ACTIVE,
  USABLE_SUBSCRIPTION_CREDITS,
} from '../../db/subscriptions';
import {
  addMonths,
  SUBSCRIPTION_BURN_NOTE,
  SUBSCRIPTION_GRANT_NOTE,
  type PaidPlan,
  type SubscriptionPlanId,
} from '../subscriptions/subscriptions.constants';
import { splitSpend } from './credits.constants';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';

export interface ShopCredits {
  balance: number;
  reserved: number;
  subscription: number;
  usable: number;
  available: number;
}

export interface ShopSubscriptionState {
  id: number;
  subscriptionPlan: SubscriptionPlanId;
  subscriptionUntil: Date | null;
}

export interface ShopAutofillState extends ShopSubscriptionState {
  freeUsed: number;
  available: number;
}

export interface SubscriptionGrantResult {
  burned: number;
  granted: number;
  from: Date;
  until: Date;
}

@Injectable()
export class CreditsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async find(shopId: number): Promise<ShopCredits | undefined> {
    const rows = await this.db
      .select({
        balance: shops.creditsBalance,
        reserved: shops.creditsReserved,
        subscription: shops.subscriptionCredits,
        usable: sql<number>`${USABLE_SUBSCRIPTION_CREDITS}::int`,
        available: sql<number>`${AVAILABLE_CREDITS}::int`,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return rows[0];
  }

  async findShopIdByOwner(ownerId: number): Promise<number | undefined> {
    const rows = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0]?.id;
  }

  async findShopSubscriptionByOwner(
    ownerId: number,
  ): Promise<ShopSubscriptionState | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
      })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  async findAutofillStateByOwner(
    ownerId: number,
    month: string,
  ): Promise<ShopAutofillState | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
        freeUsed: sql<number>`(case when ${shops.autofillPeriodMonth} = ${month}::date then ${shops.autofillFreeUsed} else 0 end)::int`,
        available: sql<number>`${AVAILABLE_CREDITS}::int`,
      })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  async reserve(shopId: number, credits: number): Promise<boolean> {
    const rows = await this.db
      .update(shops)
      .set({ creditsReserved: sql`${shops.creditsReserved} + ${credits}` })
      .where(and(eq(shops.id, shopId), sql`${AVAILABLE_CREDITS} >= ${credits}`))
      .returning({ id: shops.id });
    return rows.length > 0;
  }

  async release(shopId: number, credits: number): Promise<void> {
    await this.db
      .update(shops)
      .set({
        creditsReserved: sql`greatest(0, ${shops.creditsReserved} - ${credits})`,
      })
      .where(eq(shops.id, shopId));
  }

  async spend(
    shopId: number,
    reserved: number,
    credits: number,
    meta: CreditTxnMeta,
  ): Promise<{ balance: number; subscription: number }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(shops)
        .set({
          creditsReserved: sql`greatest(0, ${shops.creditsReserved} - ${reserved})`,
          creditsBalance: sql`greatest(0, ${shops.creditsBalance} + ${shops.subscriptionCredits} - ${credits})`,
          subscriptionCredits: 0,
        })
        .where(eq(shops.id, shopId))
        .returning({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
        });

      const balance = rows[0]?.balance ?? 0;
      const subscription = 0;

      if (credits > 0) {
        await tx.insert(creditTransactions).values({
          shopId,
          kind: 'spend',
          amount: -credits,
          balanceAfter: balance,
          subscriptionAfter: 0,
          meta: { ...meta, fromSubscription: 0 },
        });
      }

      return { balance, subscription };
    });
  }

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
        .returning({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
        });

      const balanceAfter = rows[0]?.balance ?? 0;

      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: data.authorId,
        kind: 'grant',
        amount: data.credits,
        balanceAfter,
        subscriptionAfter: rows[0]?.subscription ?? 0,
        note: data.note,
        meta: data.meta,
      });

      return balanceAfter;
    });
  }

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

  async hasPaidSubscription(shopId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: subscriptionPayments.id })
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.shopId, shopId),
          eq(subscriptionPayments.status, 'paid'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

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
          subscription: shops.subscriptionCredits,
          available: sql<number>`${AVAILABLE_CREDITS}::int`,
        })
        .from(shops)
        .where(eq(shops.id, data.shopId))
        .for('update');

      const balance = current[0]?.balance ?? 0;
      const available = Math.max(
        0,
        Math.min(balance, current[0]?.available ?? 0),
      );
      const taken = Math.min(data.credits, available);
      if (taken === 0) return { taken: 0, balance };

      const rows = await tx
        .update(shops)
        .set({ creditsBalance: sql`${shops.creditsBalance} - ${taken}` })
        .where(eq(shops.id, data.shopId))
        .returning({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
        });

      const balanceAfter = rows[0]?.balance ?? 0;

      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: data.authorId,
        kind: 'adjust',
        amount: -taken,
        balanceAfter,
        subscriptionAfter: rows[0]?.subscription ?? current[0]?.subscription,
        note: data.note,
      });

      return { taken, balance: balanceAfter };
    });
  }

  async claimFreeAutofill(
    shopId: number,
    month: string,
    limit: number,
  ): Promise<number | undefined> {
    const rows = await this.db
      .update(shops)
      .set({
        autofillFreeUsed: sql`case when ${shops.autofillPeriodMonth} = ${month}::date then ${shops.autofillFreeUsed} + 1 else 1 end`,
        autofillPeriodMonth: month,
      })
      .where(
        and(
          eq(shops.id, shopId),
          SUBSCRIPTION_ACTIVE,
          sql`(${shops.autofillPeriodMonth} is distinct from ${month}::date or ${shops.autofillFreeUsed} < ${limit})`,
        ),
      )
      .returning({ used: shops.autofillFreeUsed });
    return rows[0]?.used;
  }

  async releaseFreeAutofill(shopId: number, month: string): Promise<void> {
    await this.db
      .update(shops)
      .set({
        autofillFreeUsed: sql`greatest(0, ${shops.autofillFreeUsed} - 1)`,
      })
      .where(
        and(
          eq(shops.id, shopId),
          sql`${shops.autofillPeriodMonth} = ${month}::date`,
        ),
      );
  }

  async grantSubscription(
    data: {
      shopId: number;
      plan: PaidPlan;
      months: number;
      credits: number;
      paymentId: number | null;
      now?: Date;
    },
    tx: Tx,
  ): Promise<SubscriptionGrantResult> {
    const now = data.now ?? new Date();

    const current = await tx
      .select({
        subscription: shops.subscriptionCredits,
        balance: shops.creditsBalance,
        until: shops.subscriptionUntil,
        active: sql<boolean>`${SUBSCRIPTION_ACTIVE}`,
      })
      .from(shops)
      .where(eq(shops.id, data.shopId))
      .for('update');

    const row = current[0];
    if (!row) {
      throw new NotFoundException(
        `Магазин ${data.shopId} не найден — подписку выдавать некому`,
      );
    }

    const alive = row.active === true;
    const from = alive && row.until ? row.until : now;
    const until = addMonths(from, data.months);

    const updated = await tx
      .update(shops)
      .set({
        subscriptionPlan: data.plan,
        subscriptionUntil: until,
        creditsBalance: sql` +  + `,
        subscriptionCredits: 0,
        updatedAt: now,
      })
      .where(eq(shops.id, data.shopId))
      .returning({ balance: shops.creditsBalance });

    const balanceAfter =
      updated[0]?.balance ?? (row.balance ?? 0) + (row.subscription ?? 0) + data.credits;

    await tx.insert(creditTransactions).values({
      shopId: data.shopId,
      authorId: null,
      kind: 'grant',
      amount: data.credits,
      balanceAfter,
      subscriptionAfter: 0,
      note: ` `,
      meta: {
        promo: 'subscription',
        plan: data.plan,
        paymentId: data.paymentId ?? undefined,
      },
    });

    if (data.paymentId !== null) {
      await tx
        .update(subscriptionPayments)
        .set({
          activatedFrom: from,
          activatedUntil: until,
          grantedCredits: data.credits,
          burnedCredits: 0,
        })
        .where(eq(subscriptionPayments.id, data.paymentId));
    }

    return { burned: 0, granted: data.credits, from, until };
  }

  async history(shopId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const data = await this.db
      .select({
        id: creditTransactions.id,
        kind: creditTransactions.kind,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        subscriptionAfter: creditTransactions.subscriptionAfter,
        note: creditTransactions.note,
        meta: creditTransactions.meta,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.shopId, shopId))
      .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
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
