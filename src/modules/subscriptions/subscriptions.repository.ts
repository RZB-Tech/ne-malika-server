import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb, type Tx } from '../../db/db.provider';
import {
  shops,
  subscriptionPayments,
  subscriptionReminders,
  users,
  type Shop,
  type SubscriptionPayment,
  type SubscriptionPaymentMeta,
  type SubscriptionReminder,
} from '../../db/schema';
import { SUBSCRIPTION_ACTIVE, AVAILABLE_CREDITS } from '../../db/subscriptions';
import { escapeLike } from '../product-cards/product-search';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import type { FindAdminSubscriptionsQueryDto } from './dto/find-admin-subscriptions-query.dto';
import type { SubscriptionPlanId } from './subscriptions.constants';

export interface PaymentShop {
  id: number;
  name: string;
  ownerId: number;
  ownerTelegramId: number;
}

export interface PaymentOrder {
  id: number;
  merchantBillingId: number;
  shopId: number;
  shopName: string;
  shopStatus: string;
  ownerId: number;
  ownerTelegramId: number;
}

export interface LockedShop {
  id: number;
  name: string;
  owner: number;
  status: Shop['status'];
  subscriptionPlan: SubscriptionPlanId;
  subscriptionUntil: Date | null;
}

export interface SubscriptionStateRow {
  subscriptionPlan: SubscriptionPlanId;
  subscriptionUntil: Date | null;
  subscriptionCredits: number;
  creditsBalance: number;
  creditsReserved: number;
  available: number;
  autofillUsed: number;
}

export interface AdminSubscriptionRow {
  shopId: number;
  shopName: string;
  shopStatus: Shop['status'];
  ownerId: number;
  ownerName: string;
  ownerUsername: string | null;
  storedPlan: SubscriptionPlanId;
  until: Date | null;
  subscriptionCredits: number;
  lastPaidAt: Date | null;
  stuckPrepared: boolean;
  needsManualReview: boolean;
}

export interface ReminderCandidate {
  shopId: number;
  shopName: string;
  ownerId: number;
  expiresAt: Date;
  daysLeft: number;
}

@Injectable()
export class SubscriptionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  private static mergeMeta(patch: SubscriptionPaymentMeta): SQL {
    return sql`coalesce(${subscriptionPayments.meta}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
  }

  async createOrder(data: {
    shopId: number;
    plan: SubscriptionPlanId;
    amount: number;
    initiatorId: number | null;
    meta: SubscriptionPaymentMeta;
  }): Promise<SubscriptionPayment> {
    const rows = await this.db
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: 'click',
        plan: data.plan,
        amount: data.amount,
        status: 'pending',
        initiatorId: data.initiatorId,
        meta: data.meta,
      })
      .returning();
    return rows[0];
  }

  async findReusableOrder(data: {
    shopId: number;
    plan: SubscriptionPlanId;
    amount: number;
    test: boolean;
    since: Date;
  }): Promise<SubscriptionPayment | undefined> {
    const rows = await this.db
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.shopId, data.shopId),
          eq(subscriptionPayments.provider, 'click'),
          eq(subscriptionPayments.plan, data.plan),
          eq(subscriptionPayments.status, 'pending'),
          sql`${subscriptionPayments.amount} = ${data.amount}`,
          sql`coalesce((${subscriptionPayments.meta} ->> 'test')::boolean, false) = ${data.test}`,
          sql`${subscriptionPayments.createdAt} > ${data.since.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(desc(subscriptionPayments.createdAt))
      .limit(1);
    return rows[0];
  }

  async patchOrderMeta(
    id: number,
    patch: SubscriptionPaymentMeta,
  ): Promise<void> {
    await this.db
      .update(subscriptionPayments)
      .set({ meta: SubscriptionsRepository.mergeMeta(patch) })
      .where(eq(subscriptionPayments.id, id));
  }

  async findSolePendingByAmount(
    amount: number,
    since: Date,
  ): Promise<PaymentOrder | undefined> {
    const rows = await this.db
      .select({
        id: subscriptionPayments.id,
        merchantBillingId: subscriptionPayments.merchantBillingId,
        shopId: subscriptionPayments.shopId,
        shopName: shops.name,
        shopStatus: shops.status,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(subscriptionPayments)
      .innerJoin(shops, eq(subscriptionPayments.shopId, shops.id))
      .innerJoin(users, eq(shops.owner, users.id))
      .where(
        and(
          eq(subscriptionPayments.provider, 'click'),
          eq(subscriptionPayments.status, 'pending'),
          eq(shops.status, 'active'),
          sql`${subscriptionPayments.amount} = ${amount}`,
          sql`${subscriptionPayments.createdAt} > ${since.toISOString()}::timestamptz`,
        ),
      )
      .limit(2);

    return rows.length === 1 ? rows[0] : undefined;
  }

  async findOwnOrder(
    ownerId: number,
    merchantBillingId: number,
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await this.db
      .select({ payment: subscriptionPayments })
      .from(subscriptionPayments)
      .innerJoin(shops, eq(subscriptionPayments.shopId, shops.id))
      .where(
        and(
          eq(subscriptionPayments.merchantBillingId, merchantBillingId),
          eq(shops.owner, ownerId),
        ),
      )
      .limit(1);
    return rows[0]?.payment;
  }

  async lockByBillingId(
    tx: Tx,
    merchantBillingId: number,
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.merchantBillingId, merchantBillingId))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async attachClickToOrder(
    tx: Tx,
    id: number,
    data: {
      providerTransactionId: string;
      providerPaymentId: string;
      providerPrepareId: string;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({
        status: 'prepared',
        providerTransactionId: data.providerTransactionId,
        providerPaymentId: data.providerPaymentId,
        providerPrepareId: data.providerPrepareId,
        meta: SubscriptionsRepository.mergeMeta(data.meta),
      })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  async lockByProviderTransaction(
    tx: Tx,
    providerTransactionId: string,
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.provider, 'click'),
          eq(subscriptionPayments.providerTransactionId, providerTransactionId),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0];
  }

  async setPrepareId(
    tx: Tx,
    id: number,
    prepareId: string,
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({ providerPrepareId: prepareId })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  async markPaid(
    tx: Tx,
    id: number,
    data: {
      activatedFrom: Date | null;
      activatedUntil: Date | null;
      grantedCredits: number;
      burnedCredits: number;
      paidAt: Date;
    },
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({
        status: 'paid',
        activatedFrom: data.activatedFrom,
        activatedUntil: data.activatedUntil,
        grantedCredits: data.grantedCredits,
        burnedCredits: data.burnedCredits,
        paidAt: data.paidAt,
        cancelledAt: null,
      })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  async markCancelled(
    tx: Tx,
    id: number,
    meta: SubscriptionPaymentMeta,
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        meta: SubscriptionsRepository.mergeMeta(meta),
      })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  async patchMeta(
    tx: Tx,
    id: number,
    meta: SubscriptionPaymentMeta,
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({ meta: SubscriptionsRepository.mergeMeta(meta) })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  async insertCancelled(
    tx: Tx,
    data: {
      shopId: number;
      plan: SubscriptionPlanId;
      amount: number;
      providerTransactionId: string;
      providerPaymentId: string;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: 'click',
        plan: data.plan,
        amount: data.amount,
        status: 'cancelled',
        providerTransactionId: data.providerTransactionId,
        providerPaymentId: data.providerPaymentId,
        cancelledAt: new Date(),
        meta: data.meta,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  async insertManual(
    tx: Tx,
    data: {
      shopId: number;
      plan: SubscriptionPlanId;
      amount: number;
      initiatorId: number;
      paidAt: Date;
      activatedFrom?: Date | null;
      activatedUntil?: Date | null;
      grantedCredits?: number | null;
      burnedCredits?: number | null;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: 'manual',
        plan: data.plan,
        amount: data.amount,
        status: 'paid',
        initiatorId: data.initiatorId,
        paidAt: data.paidAt,
        activatedFrom: data.activatedFrom ?? null,
        activatedUntil: data.activatedUntil ?? null,
        grantedCredits: data.grantedCredits ?? null,
        burnedCredits: data.burnedCredits ?? null,
        meta: data.meta,
      })
      .returning();
    return rows[0];
  }

  async hasRecentManual(
    tx: Tx,
    shopId: number,
    seconds: number,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: subscriptionPayments.id })
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.shopId, shopId),
          eq(subscriptionPayments.provider, 'manual'),
          eq(subscriptionPayments.status, 'paid'),
          sql`coalesce(${subscriptionPayments.grantedCredits}, 0) > 0`,
          sql`${subscriptionPayments.createdAt} > now() - (${seconds}::int * interval '1 second')`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async lockShop(tx: Tx, shopId: number): Promise<LockedShop | undefined> {
    const rows = await tx
      .select({
        id: shops.id,
        name: shops.name,
        owner: shops.owner,
        status: shops.status,
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async findShopById(shopId: number): Promise<PaymentShop | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(and(eq(shops.id, shopId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  async findOrderForPayment(
    merchantBillingId: number,
  ): Promise<PaymentOrder | undefined> {
    const rows = await this.db
      .select({
        id: subscriptionPayments.id,
        merchantBillingId: subscriptionPayments.merchantBillingId,
        shopId: subscriptionPayments.shopId,
        shopName: shops.name,
        shopStatus: shops.status,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(subscriptionPayments)
      .innerJoin(shops, eq(subscriptionPayments.shopId, shops.id))
      .innerJoin(users, eq(shops.owner, users.id))
      .where(eq(subscriptionPayments.merchantBillingId, merchantBillingId))
      .limit(1);
    return rows[0];
  }

  async findShopByOwner(ownerId: number): Promise<PaymentShop | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  async stateOf(
    shopId: number,
    month: string,
  ): Promise<SubscriptionStateRow | undefined> {
    const rows = await this.db
      .select({
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
        subscriptionCredits: sql<number>`${shops.subscriptionCredits}::int`,
        creditsBalance: sql<number>`${shops.creditsBalance}::int`,
        creditsReserved: sql<number>`${shops.creditsReserved}::int`,
        available: sql<number>`${AVAILABLE_CREDITS}::int`,
        autofillUsed: sql<number>`(case when ${shops.autofillPeriodMonth} = ${month}::date then ${shops.autofillFreeUsed} else 0 end)::int`,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return rows[0];
  }

  async expireSubscription(tx: Tx, shopId: number, now: Date): Promise<void> {
    await tx
      .update(shops)
      .set({ subscriptionUntil: now, updatedAt: now })
      .where(eq(shops.id, shopId));
  }

  async paymentsOf(shopId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const data = await this.db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.shopId, shopId))
      .orderBy(
        desc(subscriptionPayments.createdAt),
        desc(subscriptionPayments.id),
      )
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.shopId, shopId))
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }

  async adminList(query: FindAdminSubscriptionsQueryDto): Promise<{
    data: AdminSubscriptionRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, offset } = resolvePage(query);

    const stuckPrepared = sql<boolean>`${exists(
      this.db
        .select({ one: sql`1` })
        .from(subscriptionPayments)
        .where(
          and(
            eq(subscriptionPayments.shopId, shops.id),
            eq(subscriptionPayments.status, 'prepared'),
            sql`${subscriptionPayments.createdAt} < now() - interval '1 day'`,
          ),
        ),
    )}`;

    const needsManualReview = sql<boolean>`${exists(
      this.db
        .select({ one: sql`1` })
        .from(subscriptionPayments)
        .where(
          and(
            eq(subscriptionPayments.shopId, shops.id),
            sql`${subscriptionPayments.meta}->>'needsManualReview' = 'true'`,
          ),
        ),
    )}`;

    const conditions: SQL[] = [];

    if (query.plan) {
      conditions.push(
        query.plan === 'free'
          ? sql`NOT ${SUBSCRIPTION_ACTIVE}`
          : sql`(${eq(shops.subscriptionPlan, query.plan)} AND ${SUBSCRIPTION_ACTIVE})`,
      );
    }

    if (query.expiring_days !== undefined) {
      conditions.push(
        sql`(${SUBSCRIPTION_ACTIVE} AND ${shops.subscriptionUntil} <= now() + (${query.expiring_days}::int * interval '1 day'))`,
      );
    }

    if (query.needs_review) conditions.push(needsManualReview);

    const search = query.q?.trim();
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      const like = or(
        ilike(shops.name, pattern),
        ilike(shops.contact, pattern),
        ilike(users.fullname, pattern),
        ilike(users.telegramUsername, pattern),
      );
      if (like) conditions.push(like);
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const order =
      query.expiring_days !== undefined
        ? sql`${shops.subscriptionUntil} asc nulls last`
        : sql`${shops.subscriptionUntil} desc nulls last`;

    const data = await this.db
      .select({
        shopId: shops.id,
        shopName: shops.name,
        shopStatus: shops.status,
        ownerId: users.id,
        ownerName: users.fullname,
        ownerUsername: users.telegramUsername,
        storedPlan: shops.subscriptionPlan,
        until: shops.subscriptionUntil,
        subscriptionCredits: sql<number>`${shops.subscriptionCredits}::int`,
        lastPaidAt: sql<Date | null>`(select max(${subscriptionPayments.paidAt}) from ${subscriptionPayments} where ${subscriptionPayments.shopId} = ${shops.id} and ${subscriptionPayments.status} = 'paid')`,
        stuckPrepared,
        needsManualReview,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(where)
      .orderBy(order, desc(shops.id))
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(where)
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }

  async reminderCandidates(leadDays: number): Promise<ReminderCandidate[]> {
    return this.db
      .select({
        shopId: shops.id,
        shopName: shops.name,
        ownerId: users.id,
        expiresAt: sql<Date>`${shops.subscriptionUntil}`,
        daysLeft: sql<number>`((${shops.subscriptionUntil} AT TIME ZONE 'Asia/Tashkent')::date - (now() AT TIME ZONE 'Asia/Tashkent')::date)::int`,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(
        and(
          eq(shops.status, 'active'),
          SUBSCRIPTION_ACTIVE,
          sql`${users.blockedAt} is null`,
          sql`(${shops.subscriptionUntil} AT TIME ZONE 'Asia/Tashkent')::date between (now() AT TIME ZONE 'Asia/Tashkent')::date and (now() AT TIME ZONE 'Asia/Tashkent')::date + ${leadDays}::int`,
        ),
      )
      .orderBy(shops.subscriptionUntil);
  }

  async claimReminders(
    rows: {
      shopId: number;
      stage: SubscriptionReminder['stage'];
      expiresAt: Date;
    }[],
  ): Promise<{ id: number; shopId: number }[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(subscriptionReminders)
      .values(rows)
      .onConflictDoNothing()
      .returning({
        id: subscriptionReminders.id,
        shopId: subscriptionReminders.shopId,
      });
  }

  async confirmReminders(
    updates: { id: number; telegram: boolean; push: number }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(subscriptionReminders)
          .set({
            telegramDelivered: update.telegram,
            pushDelivered: update.push,
          })
          .where(eq(subscriptionReminders.id, update.id));
      }
    });
  }

  async releaseReminders(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(subscriptionReminders)
      .where(inArray(subscriptionReminders.id, ids));
  }

  async purgeReminders(days: number): Promise<number> {
    const rows = await this.db
      .delete(subscriptionReminders)
      .where(
        sql`${subscriptionReminders.createdAt} < now() - (${days}::int * interval '1 day')`,
      )
      .returning({ id: subscriptionReminders.id });
    return rows.length;
  }
}
