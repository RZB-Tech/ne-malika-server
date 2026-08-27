import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.schema';
import { users } from './users.schema';
import {
  paymentProviderEnum,
  paymentStatusEnum,
  subscriptionPlanEnum,
} from './enums';

/** Что осталось от колбэка провайдера сверх того, что легло в колонки. */
export interface SubscriptionPaymentMeta {
  /** Click: `service_id` — по нему ловим колбэк не от нашего сервиса. */
  serviceId?: string;
  /** Click: `sign_time` последнего пришедшего запроса. */
  signTime?: string;
  /** Click: `error`/`error_note` — почему провайдер отменил платёж. */
  error?: number;
  errorNote?: string;
  /** Merchant API reversal: возвращали ли деньги и чем это кончилось. */
  reversed?: boolean;
  reversalNote?: string;
  /**
   * Строку обязан посмотреть человек: деньги списаны, а автоматика довести
   * дело до конца не смогла. Отдельный флаг, а не вывод из статуса, — по нему
   * админка собирает вкладку «Требуют разбора», и заводить ради этого запрос
   * с перечислением всех неудачных сочетаний статуса и меты не хочется.
   */
  needsManualReview?: boolean;
  /** Провайдер сам вернул уже оплаченный платёж — период при этом не отзывается. */
  refundedByProvider?: boolean;
  /** Кто активировал вручную и почему — только у provider = 'manual'. */
  adminId?: number;
  note?: string;
}

/**
 * Платежи за подписку магазина.
 *
 * Журнал, а не «текущая подписка»: текущее состояние лежит на `shops`
 * (`subscription_plan`, `subscription_until`), потому что читается на каждом
 * действии продавца и в каждом запросе витрины. Здесь — то, из чего это
 * состояние сложилось, и единственное место, куда можно смотреть при споре
 * «деньги ушли, подписки нет». Инвариант: `shops.subscription_until` равен
 * максимальному `activated_until` среди строк со статусом `paid`.
 *
 * Строка заводится на Prepare, а не до похода в кассу: так сделано в рабочем
 * образце (save-up), и это единственный вариант, который переживает оплату из
 * приложения Click, где номер счёта человек вводит руками и нашей «заготовки»
 * под него не существует.
 */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    provider: paymentProviderEnum('provider').notNull().default('click'),

    /**
     * Тариф, за который заплатили. Снимок, а не ссылка на `shops`: тариф
     * магазина поменяется, а этот платёж останется платежом за то, что
     * купили тогда. Определяется по сумме, как в save-up.
     */
    plan: subscriptionPlanEnum('plan').notNull(),

    /**
     * Сумма в сумах. `numeric`, как цена товара: деньги с плавающей точкой
     * сравнивать нельзя, а Click присылает сумму с копейками.
     *
     * `mode: 'number'` обязателен. Без него drizzle отдаёт колонку строкой, и
     * сверка суммы Complete превращается в сравнение `"65000.00"` с `"65000"` —
     * то есть в отказ `invalid_amount (-2)` на каждый успешный платёж, уже
     * после того как деньги списаны.
     */
    amount: numeric('amount', {
      precision: 14,
      scale: 2,
      mode: 'number',
    }).notNull(),

    status: paymentStatusEnum('status').notNull().default('prepared'),

    /**
     * `click_trans_id` — номер транзакции у провайдера. По нему и только по
     * нему платёж опознаётся в повторных колбэках: Click повторяет запрос при
     * любом сетевом сбое, и без уникальности один платёж выдал бы подписку
     * дважды. Пусто у ручной активации.
     *
     * Все три идентификатора провайдера ниже — `varchar(64)`, а не `bigint`:
     * протокол передаёт их строками, сравниваются они строкой, а приведение
     * туда-обратно — лишний способ потерять ведущий ноль или переполнить int8.
     */
    providerTransactionId: varchar('provider_transaction_id', { length: 64 }),

    /** `click_paydoc_id` — номер платёжного документа; он же уходит в reversal. */
    providerPaymentId: varchar('provider_payment_id', { length: 64 }),

    /**
     * `merchant_prepare_id` — то, что мы вернули провайдеру в ответе на
     * Prepare и что он присылает обратно в Complete. Хранится, чтобы сверить
     * пришедшее с выданным: Complete с чужим prepare_id — не наш платёж.
     */
    providerPrepareId: varchar('provider_prepare_id', { length: 64 }),

    /**
     * Наш номер счёта: он и есть `merchant_prepare_id`/`merchant_confirm_id`.
     *
     * Отдельная последовательность, а не `id`: номер видит человек — он уходит
     * в ответ провайдеру, в чек и в обращение в поддержку, — и должен быть
     * коротким целым, а не bigint'ом, растущим вместе со всеми таблицами.
     */
    merchantBillingId: integer('merchant_billing_id')
      .notNull()
      .generatedByDefaultAsIdentity({
        name: 'subscription_payments_merchant_billing_id_seq',
        startWith: 100000,
      }),

    /**
     * Период, который оплатил именно этот платёж. Продление до истечения
     * прежнего начинается не с `now()`, а с конца прежнего — иначе оплата
     * заранее съедала бы оплаченные дни.
     */
    activatedFrom: timestamp('activated_from', { withTimezone: true }),
    activatedUntil: timestamp('activated_until', { withTimezone: true }),

    /** Сколько подписочных кредитов выдал платёж и сколько при этом сожгло. */
    grantedCredits: bigint('granted_credits', { mode: 'number' }),
    burnedCredits: bigint('burned_credits', { mode: 'number' }),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    /**
     * Кто активировал подписку руками. Заполняется только при
     * `provider = 'manual'`: у платежей Click строку заводит колбэк Prepare, а
     * там аутентифицированного пользователя нет вовсе — приходит запрос от
     * провайдера, а не от человека. `set null`, потому что магазин может
     * сменить владельца, а администратор — уволиться; платёж останется.
     */
    initiatorId: bigint('initiator_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    meta: jsonb('meta').$type<SubscriptionPaymentMeta>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * `$onUpdate` обязателен: строка меняется трижды за жизнь платежа
     * (Prepare → Complete → возможная отмена), и без него колонка навсегда
     * осталась бы равной `created_at` — то есть врала бы ровно там, где по ней
     * и разбирают, когда именно платёж перешёл в нынешнее состояние.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    /**
     * Защита от повторной выдачи подписки по повторному колбэку. Составной с
     * провайдером: номера транзакций у Click и Payme из разных пространств, и
     * совпадение чисел не должно превращаться в конфликт. NULL не равен NULL,
     * поэтому ручные активации друг другу не мешают.
     */
    providerTxnIdx: uniqueIndex('subscription_payments_provider_txn_idx').on(
      table.provider,
      table.providerTransactionId,
    ),

    /**
     * Второй ключ идемпотентности — по номеру платёжного документа.
     *
     * Без него одно и то же списание, пришедшее под двумя разными
     * `click_trans_id` (повтор из приложения Click, ручной перезапуск разбора
     * на их стороне), завело бы две строки и оплатило два периода за одни
     * деньги. С ним `prepare()` натыкается на конфликт ещё до Complete — то
     * есть до списания, — и отвечает отказом там, где это ничего не стоит.
     */
    providerPaydocIdx: uniqueIndex(
      'subscription_payments_provider_paydoc_idx',
    ).on(table.provider, table.providerPaymentId),

    /** Номер счёта уникален: по нему сверяется Complete. */
    merchantBillingIdx: uniqueIndex(
      'subscription_payments_merchant_billing_idx',
    ).on(table.merchantBillingId),

    /** История платежей магазина — свежим вперёд, как в журнале кредитов. */
    shopIdIdx: index('subscription_payments_shop_id_idx').on(
      table.shopId,
      sql`${table.createdAt} DESC`,
    ),

    /** Разбор зависших: платежи, застрявшие в `prepared`, ищет админка. */
    statusIdx: index('subscription_payments_status_idx').on(
      table.status,
      table.createdAt,
    ),

    /**
     * Проверка в базе, а не только в DTO: сумму пишет колбэк провайдера, и
     * ноль или минус из-за чужого запроса не должен попасть в историю молча.
     */
    amountPositive: check(
      'subscription_payments_amount_positive',
      sql`${table.amount} > 0`,
    ),
  }),
);

export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
export type NewSubscriptionPayment = typeof subscriptionPayments.$inferInsert;
