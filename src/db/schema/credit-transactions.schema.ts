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
  /** Операция: промпт, правка описания или генерация картинок. */
  operation?: 'prompt' | 'description' | 'image';
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
   * Метка акции для разовых выдач. По ней же проверяется, что магазин уже
   * получал подарок: без такой отметки повторный прогон миграции или
   * пересоздание магазина начислили бы его второй раз.
   *
   * `welcome` — приветственные кредиты, `welcome_topup` — доначисление до
   * нынешнего размера подарка тем, кто получил прежние 150.
   */
  promo?: 'welcome' | 'welcome_topup';
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
