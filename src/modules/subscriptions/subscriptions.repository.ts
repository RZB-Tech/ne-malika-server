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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
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

/**
 * Сутки в ташкентском времени — так же, как считает продуктовая статистика,
 * иначе вечерние оплаты уезжали бы в соседний день.
 */
const PAID_DAY: SQL = sql`(${subscriptionPayments.paidAt} AT TIME ZONE 'Asia/Tashkent')::date`;

const CREATED_DAY: SQL = sql`(${subscriptionPayments.createdAt} AT TIME ZONE 'Asia/Tashkent')::date`;

const NOT_TEST: SQL = sql`coalesce(${subscriptionPayments.meta}->>'test', '') <> 'true'`;

/**
 * Деньги, которые площадка действительно получила и оставила себе: оплачено,
 * не тестовый прогон и провайдер не вернул сумму назад. Возврат оставляет
 * платёж в статусе paid и только помечает meta, поэтому его надо исключать
 * отдельно — иначе выручка завышена.
 */
const REVENUE_ONLY: SQL = sql`(${subscriptionPayments.status} = 'paid'
  AND ${subscriptionPayments.paidAt} IS NOT NULL
  AND ${NOT_TEST}
  AND coalesce(${subscriptionPayments.meta}->>'refundedByProvider', '') <> 'true')`;

export interface SalesDayRow {
  day: string;
  plan: string;
  revenue: number;
  payments: number;
}

export interface SalesSliceRow {
  key: string;
  revenue: number;
  payments: number;
}

export interface SalesTotalsRow {
  payingShops: number;
  testPayments: number;
  refundedPayments: number;
  newRevenue: number;
  renewalRevenue: number;
}

export interface TopShopRow {
  shopId: number;
  name: string;
  revenue: number;
  payments: number;
}

export type PaymentProvider = SubscriptionPayment['provider'];

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

export interface OrderWithShop {
  payment: SubscriptionPayment;
  shopName: string;
  shopStatus: Shop['status'];
  ownerId: number;
}

interface LockedShop {
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
    provider: PaymentProvider;
    plan: SubscriptionPlanId;
    amount: number;
    initiatorId: number | null;
    meta: SubscriptionPaymentMeta;
  }): Promise<SubscriptionPayment> {
    const rows = await this.db
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: data.provider,
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
    provider: PaymentProvider;
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
          eq(subscriptionPayments.provider, data.provider),
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
    provider: PaymentProvider,
    providerTransactionId: string,
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.provider, provider),
          eq(subscriptionPayments.providerTransactionId, providerTransactionId),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0];
  }

  /**
   * Привязка транзакции Payme к заказу. Один заказ держит ровно одну
   * транзакцию: вторую по тому же счёту протокол обязывает отбить.
   */
  async attachPaymeTransaction(
    tx: Tx,
    id: number,
    data: {
      providerTransactionId: string;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({
        status: 'prepared',
        providerTransactionId: data.providerTransactionId,
        providerPrepareId: data.providerTransactionId,
        meta: SubscriptionsRepository.mergeMeta(data.meta),
      })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Выписка для GetStatement: транзакции Payme, созданные в интервале.
   * Время создания хранится в meta.paymeCreateTime — миллисекунды, как
   * их считает сам протокол.
   */
  async findPaymeStatement(
    fromMs: number,
    toMs: number,
  ): Promise<SubscriptionPayment[]> {
    return this.db
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.provider, 'payme'),
          sql`(${subscriptionPayments.meta} ->> 'paymeCreateTime')::bigint between ${fromMs} and ${toMs}`,
        ),
      )
      .orderBy(subscriptionPayments.id);
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
    return this.findPaymentShop(eq(shops.id, shopId));
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

  /** Счёт вместе с магазином — чтения хватает, блокировка тут не нужна. */
  async findOrderWithShop(
    merchantBillingId: number,
  ): Promise<OrderWithShop | undefined> {
    const rows = await this.db
      .select({
        payment: subscriptionPayments,
        shopName: shops.name,
        shopStatus: shops.status,
        ownerId: shops.owner,
      })
      .from(subscriptionPayments)
      .innerJoin(shops, eq(subscriptionPayments.shopId, shops.id))
      .where(eq(subscriptionPayments.merchantBillingId, merchantBillingId))
      .limit(1);
    return rows[0];
  }

  async findPaymeByTransaction(
    providerTransactionId: string,
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await this.db
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.provider, 'payme'),
          eq(subscriptionPayments.providerTransactionId, providerTransactionId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findShopByOwner(ownerId: number): Promise<PaymentShop | undefined> {
    return this.findPaymentShop(eq(shops.owner, ownerId));
  }

  private async findPaymentShop(scope: SQL): Promise<PaymentShop | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(and(scope, eq(shops.status, 'active')))
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

  // ——— Отчёт по продажам подписок ———————————————————————————————————————
  //
  // Выручкой считается только реально полученное: статус paid, не тестовая
  // оплата и не возврат провайдера. Тестовые и возвращённые считаем отдельно,
  // чтобы в отчёте было видно, что именно вычли.

  async salesByDay(from: string, to: string): Promise<SalesDayRow[]> {
    const rows = await this.db.execute<{
      day: string;
      revenue: string;
      payments: string;
      plan: string;
    }>(
      sql`select ${PAID_DAY} as day,
                 ${subscriptionPayments.plan} as plan,
                 sum(${subscriptionPayments.amount})::text as revenue,
                 count(*)::text as payments
            from ${subscriptionPayments}
           where ${REVENUE_ONLY}
             and ${PAID_DAY} between ${from} and ${to}
           group by 1, 2`,
    );

    return (rows.rows ?? []).map((r) => ({
      day: String(r.day).slice(0, 10),
      plan: r.plan,
      revenue: Number(r.revenue ?? 0),
      payments: Number(r.payments ?? 0),
    }));
  }

  async salesByProvider(from: string, to: string): Promise<SalesSliceRow[]> {
    return this.slice(subscriptionPayments.provider, from, to);
  }

  async salesByPlan(from: string, to: string): Promise<SalesSliceRow[]> {
    return this.slice(subscriptionPayments.plan, from, to);
  }

  /**
   * Счёта, выставленные за период, по их итоговому состоянию. Здесь нужны все,
   * включая неоплаченные: из них считается доходимость до оплаты. Тестовые
   * счёта отбрасываем — они бы завысили и знаменатель, и конверсию.
   */
  async invoicesByStatus(from: string, to: string): Promise<SalesSliceRow[]> {
    const rows = await this.db.execute<{ key: string; payments: string }>(
      sql`select ${subscriptionPayments.status} as key,
                 count(*)::text as payments
            from ${subscriptionPayments}
           where ${NOT_TEST}
             and ${CREATED_DAY} between ${from} and ${to}
           group by 1`,
    );

    return (rows.rows ?? []).map((r) => ({
      key: String(r.key),
      revenue: 0,
      payments: Number(r.payments ?? 0),
    }));
  }

  async salesTotals(from: string, to: string): Promise<SalesTotalsRow> {
    const rows = await this.db.execute<{
      paying_shops: string;
      test_payments: string;
      refunded_payments: string;
      new_revenue: string;
      renewal_revenue: string;
    }>(
      sql`with paid as (
            select ${subscriptionPayments.shopId} as shop_id,
                   ${subscriptionPayments.amount} as amount,
                   ${subscriptionPayments.paidAt} as paid_at
              from ${subscriptionPayments}
             where ${REVENUE_ONLY}
               and ${PAID_DAY} between ${from} and ${to}
          ),
          first_ever as (
            select ${subscriptionPayments.shopId} as shop_id,
                   min(${subscriptionPayments.paidAt}) as first_paid_at
              from ${subscriptionPayments}
             where ${REVENUE_ONLY}
             group by 1
          )
          select
            (select count(distinct shop_id)::text from paid) as paying_shops,
            (select count(*)::text
               from ${subscriptionPayments}
              where ${subscriptionPayments.status} = 'paid'
                and ${subscriptionPayments.meta}->>'test' = 'true'
                and ${PAID_DAY} between ${from} and ${to}) as test_payments,
            (select count(*)::text
               from ${subscriptionPayments}
              where ${subscriptionPayments.status} = 'paid'
                and ${subscriptionPayments.meta}->>'refundedByProvider' = 'true'
                and ${PAID_DAY} between ${from} and ${to}) as refunded_payments,
            coalesce((select sum(p.amount)
               from paid p
               join first_ever f on f.shop_id = p.shop_id
              where p.paid_at = f.first_paid_at), 0)::text as new_revenue,
            coalesce((select sum(p.amount)
               from paid p
               join first_ever f on f.shop_id = p.shop_id
              where p.paid_at <> f.first_paid_at), 0)::text as renewal_revenue`,
    );

    const row = rows.rows?.[0];
    return {
      payingShops: Number(row?.paying_shops ?? 0),
      testPayments: Number(row?.test_payments ?? 0),
      refundedPayments: Number(row?.refunded_payments ?? 0),
      newRevenue: Number(row?.new_revenue ?? 0),
      renewalRevenue: Number(row?.renewal_revenue ?? 0),
    };
  }

  async topShopsByRevenue(
    from: string,
    to: string,
    limit: number,
  ): Promise<TopShopRow[]> {
    const rows = await this.db.execute<{
      shop_id: string;
      name: string;
      revenue: string;
      payments: string;
    }>(
      sql`select ${subscriptionPayments.shopId} as shop_id,
                 ${shops.name} as name,
                 sum(${subscriptionPayments.amount})::text as revenue,
                 count(*)::text as payments
            from ${subscriptionPayments}
            join ${shops} on ${shops.id} = ${subscriptionPayments.shopId}
           where ${REVENUE_ONLY}
             and ${PAID_DAY} between ${from} and ${to}
           group by 1, 2
           order by sum(${subscriptionPayments.amount}) desc
           limit ${limit}`,
    );

    return (rows.rows ?? []).map((r) => ({
      shopId: Number(r.shop_id),
      name: String(r.name ?? ''),
      revenue: Number(r.revenue ?? 0),
      payments: Number(r.payments ?? 0),
    }));
  }

  /** Срез на сейчас, а не за период: кто прямо сейчас сидит на каждом тарифе. */
  async activeShopsByPlan(): Promise<{ plan: string; shops: number }[]> {
    const rows = await this.db.execute<{ plan: string; shops: string }>(
      sql`select ${shops.subscriptionPlan} as plan, count(*)::text as shops
            from ${shops}
           where ${SUBSCRIPTION_ACTIVE}
           group by 1`,
    );

    return (rows.rows ?? []).map((r) => ({
      plan: String(r.plan),
      shops: Number(r.shops ?? 0),
    }));
  }

  private async slice(
    column: AnyPgColumn,
    from: string,
    to: string,
  ): Promise<SalesSliceRow[]> {
    const rows = await this.db.execute<{
      key: string;
      revenue: string;
      payments: string;
    }>(
      sql`select ${column} as key,
                 sum(${subscriptionPayments.amount})::text as revenue,
                 count(*)::text as payments
            from ${subscriptionPayments}
           where ${REVENUE_ONLY}
             and ${PAID_DAY} between ${from} and ${to}
           group by 1
           order by sum(${subscriptionPayments.amount}) desc`,
    );

    return (rows.rows ?? []).map((r) => ({
      key: String(r.key),
      revenue: Number(r.revenue ?? 0),
      payments: Number(r.payments ?? 0),
    }));
  }
}
