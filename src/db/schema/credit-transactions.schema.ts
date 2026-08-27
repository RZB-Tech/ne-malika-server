import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { creditTxnKindEnum } from './enums';
import { shops } from './shops.schema';
import { users } from './users.schema';

/** Что записано в meta: подробности расхода для разбора спорных списаний. */
export interface CreditTxnMeta {
  /**
   * Операция: промпт, правка описания, генерация картинок или автозаполнение
   * карточки по фотографиям.
   */
  operation?: 'prompt' | 'description' | 'image' | 'autofill';
  model?: string;
  /** Фактическая стоимость у OpenRouter, доллары. */
  usd?: number;
  /** Сколько картинок пришло — для операции image. */
  images?: number;
  /** Сколько заплатил магазин и с каким множителем — для операции grant. */
  paidUsd?: number;
  markup?: number;
  /** Списано по оценке, потому что OpenRouter не вернул стоимость. */
  estimated?: boolean;
  /**
   * Списано по объявленному прайсу, а не по себестоимости запроса. Отметка
   * нужна при разборе жалоб: без неё расхождение суммы с `usd` выглядит
   * ошибкой расчёта, хотя это и есть цена операции.
   */
  fixed?: boolean;
  /**
   * Метка акции для разовых выдач. По ней же проверяется, что магазин уже
   * получал подарок: без такой отметки повторный прогон миграции или
   * пересоздание магазина начислили бы его второй раз.
   *
   * `welcome` — приветственные кредиты, `welcome_topup` — доначисление до
   * нынешнего размера подарка тем, кто получил прежние 150.
   * `subscription` — выдача нормы за оплаченный период, `subscription_burn` —
   * сгорание остатка прошлой нормы в тот же момент. Две разные метки, а не
   * одна со знаком суммы: выдачу и сгорание продавец видит в истории как два
   * разных события, и объяснять их приходится по-разному.
   */
  promo?: 'welcome' | 'welcome_topup' | 'subscription' | 'subscription_burn';
  /** Сколько из списания ушло с подписочного баланса. Остальное — с обычного. */
  fromSubscription?: number;
  /** Тариф, по которому выдано или сожжено. */
  plan?: 'start' | 'pro' | 'max';
  /** Платёж, породивший выдачу — по нему платёж и выдача связываются в разборе. */
  paymentId?: number;
  /** Автозаполнение прошло бесплатно: по месячной норме START либо по безлимиту. */
  free?: 'quota' | 'unlimited';
}

/**
 * Журнал движения кредитов.
 *
 * Для денег журнал обязателен: без него нельзя ни разобрать жалобу «списали
 * лишнего», ни понять, куда ушёл баланс. `balance_after` пишется рядом с
 * суммой, чтобы историю можно было читать без пересчёта всей ленты.
 *
 * Магазин удаляется вместе с журналом (CASCADE), автор — SET NULL: увольнение
 * администратора не должно стирать историю выдач.
 */
export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    shopId: bigint('shop_id', { mode: 'number' })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    /** Кто выдал. У списаний пусто — их делает система. */
    authorId: bigint('author_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    kind: creditTxnKindEnum('kind').notNull(),

    /** Со знаком: выдача положительна, списание отрицательно. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),

    /**
     * Остаток подписочных кредитов после операции. Пусто у строк, написанных
     * до появления подписок, — переписывать историю задним числом здесь не
     * принято (см. 0032_credits_paid_units.sql).
     *
     * Отдельной колонкой, а не заменой смысла `balance_after`: тот означает
     * «сколько осталось на несгорающем балансе» во всех уже написанных
     * строках, и менять его значение задним числом — это тихо испортить
     * миллион записей ради удобства одного отчёта.
     */
    subscriptionAfter: bigint('subscription_after', { mode: 'number' }),

    note: varchar('note', { length: 200 }),
    meta: jsonb('meta').$type<CreditTxnMeta>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    shopIdIdx: index('credit_transactions_shop_id_idx').on(
      table.shopId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export type CreditTransaction = typeof creditTransactions.$inferSelect;
