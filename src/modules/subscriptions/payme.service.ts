import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tx } from '../../db/db.provider';
import type { SubscriptionPayment } from '../../db/schema';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import {
  PAYME_CANCEL_REASON,
  PAYME_ERROR,
  PAYME_STATE,
  PAYME_TIMEOUT_MS,
  buildFiscalDetail,
  paramAmountTiyin,
  paramOrderId,
  paramReason,
  paramTime,
  paramTransactionId,
  uzsToTiyin,
  type PaymeFiscalDetail,
  type PaymeMethod,
} from './payme-protocol';

interface CheckPerformResult {
  allow: true;
  detail?: PaymeFiscalDetail;
}

interface CreateResult {
  create_time: number;
  transaction: string;
  state: number;
  receivers: null;
}

interface PerformResult {
  transaction: string;
  perform_time: number;
  state: number;
}

interface CancelResult {
  transaction: string;
  cancel_time: number;
  state: number;
}

interface CheckResult {
  create_time: number;
  perform_time: number;
  cancel_time: number;
  transaction: string;
  state: number;
  reason: number | null;
}

interface StatementRow extends CheckResult {
  id: string;
  time: number;
  amount: number;
  account: Record<string, string>;
  receivers: null;
}

interface StatementResult {
  transactions: StatementRow[];
}

/**
 * Отмену по таймауту нужно закоммитить, а ошибку протокола отдать уже после:
 * throw внутри транзакции откатил бы отмену вместе с собой.
 */
type CreateOutcome = { kind: 'ok'; result: CreateResult } | { kind: 'timeout' };

/**
 * Итог PerformTransaction: выдача подписки завершается внутри транзакции,
 * а уведомление продавцу уходит уже после коммита.
 */
type PerformOutcome =
  | { performed: false; result: PerformResult }
  | { performed: false; timedOut: true }
  | {
      performed: true;
      ownerId: number;
      payment: SubscriptionPayment;
      test: boolean;
      result: PerformResult;
    };

export type PaymeResult =
  | CheckPerformResult
  | CreateResult
  | PerformResult
  | CancelResult
  | CheckResult
  | StatementResult;

/**
 * Merchant API Payme поверх журнала подписок: заказ — это строка
 * subscription_payments, а account.order_id — её merchant_billing_id.
 * У одного заказа живёт ровно одна транзакция Payme, поэтому её состояние
 * хранится рядом со счётом, в meta.
 */
@Injectable()
export class PaymeService {
  private readonly logger = new Logger(PaymeService.name);

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  key(): string | undefined {
    return this.config.get<string>('payme.key');
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('payme.merchantId') && this.key());
  }

  private accountField(): string {
    return this.subscriptions.paymeAccountField();
  }

  async handle(
    method: PaymeMethod,
    params: Record<string, unknown>,
  ): Promise<PaymeResult> {
    switch (method) {
      case 'CheckPerformTransaction':
        return this.checkPerformTransaction(params);
      case 'CreateTransaction':
        return this.createTransaction(params);
      case 'PerformTransaction':
        return this.performTransaction(params);
      case 'CancelTransaction':
        return this.cancelTransaction(params);
      case 'CheckTransaction':
        return this.checkTransaction(params);
      case 'GetStatement':
        return this.getStatement(params);
    }
  }

  private state(payment: SubscriptionPayment): number {
    const stored = payment.meta?.paymeState;
    if (typeof stored === 'number') return stored;
    if (payment.status === 'paid') return PAYME_STATE.performed;
    if (payment.status === 'cancelled') return PAYME_STATE.cancelled;
    return PAYME_STATE.created;
  }

  private createTime(payment: SubscriptionPayment): number {
    return payment.meta?.paymeCreateTime ?? payment.createdAt.getTime();
  }

  private itemTitle(payment: SubscriptionPayment): string {
    if (payment.meta?.test) return 'Проверка кассы neMalika';
    return `Подписка neMalika ${payment.plan.toUpperCase()}`;
  }

  private fiscalDetail(
    payment: SubscriptionPayment,
  ): PaymeFiscalDetail | undefined {
    const ikpu = this.config.get<string>('payme.fiscal.ikpu');
    if (!ikpu) {
      this.logger.warn(
        'Фискальные данные не заданы (PAYME_FISCAL_IKPU) — detail в ответе не уйдёт. ' +
          'Если касса не залита статичными данными, чек не сформируется',
      );
      return undefined;
    }

    return buildFiscalDetail({
      title: this.itemTitle(payment),
      amountTiyin: uzsToTiyin(payment.amount),
      ikpu,
      packageCode: this.config.get<string>('payme.fiscal.packageCode'),
      vatPercent: this.config.get<number>('payme.fiscal.vatPercent') ?? 12,
      receiptType: this.config.get<number>('payme.fiscal.receiptType') ?? 0,
    });
  }

  /** Тестовый счёт живёт ограниченное время — после него платить нечего. */
  private testWindowExpired(
    payment: SubscriptionPayment,
    now: number,
  ): boolean {
    if (!payment.meta?.test) return false;
    const ttlMs = this.subscriptions.testWindowMinutes('payme') * 60_000;
    return now > payment.createdAt.getTime() + ttlMs;
  }

  /**
   * Общие проверки заказа для CheckPerformTransaction и CreateTransaction:
   * протокол требует одинаковых ответов на одинаковые причины отказа.
   */
  private assertPayable(
    payment: SubscriptionPayment,
    shopStatus: string,
    amountTiyin: number,
    now: number,
  ): void {
    const field = this.accountField();

    if (payment.provider !== 'payme') throw PAYME_ERROR.orderNotFound(field);
    if (shopStatus !== 'active') throw PAYME_ERROR.orderNotPayable(field);
    if (payment.status === 'paid') {
      throw PAYME_ERROR.cannotPerform('Заказ уже оплачен');
    }
    if (payment.status === 'cancelled') {
      throw PAYME_ERROR.orderNotPayable(field);
    }
    if (this.testWindowExpired(payment, now)) {
      throw PAYME_ERROR.cannotPerform('Срок тестового счёта истёк');
    }
    if (uzsToTiyin(payment.amount) !== amountTiyin) {
      throw PAYME_ERROR.invalidAmount();
    }
  }

  private async checkPerformTransaction(
    params: Record<string, unknown>,
  ): Promise<CheckPerformResult> {
    const field = this.accountField();
    const orderId = paramOrderId(params, field);
    const amountTiyin = paramAmountTiyin(params);

    const found = await this.repository.findOrderWithShop(orderId);
    if (!found) throw PAYME_ERROR.orderNotFound(field);

    this.assertPayable(
      found.payment,
      found.shopStatus,
      amountTiyin,
      Date.now(),
    );

    const detail = this.fiscalDetail(found.payment);
    return detail ? { allow: true, detail } : { allow: true };
  }

  private async createTransaction(
    params: Record<string, unknown>,
  ): Promise<CreateResult> {
    const field = this.accountField();
    const transactionId = paramTransactionId(params);
    const paymeTime = paramTime(params, 'time');
    const amountTiyin = paramAmountTiyin(params);
    const orderId = paramOrderId(params, field);
    const now = Date.now();

    const outcome = await this.repository.transaction<CreateOutcome>(
      async (tx) => {
        const payment = await this.repository.lockByBillingId(tx, orderId);
        if (!payment) throw PAYME_ERROR.orderNotFound(field);

        // Повторный вызов по той же транзакции: протокол требует идемпотентности.
        if (payment.providerTransactionId === transactionId) {
          if (this.state(payment) !== PAYME_STATE.created) {
            throw PAYME_ERROR.cannotPerform('Транзакция уже не в состоянии 1');
          }

          const createdAt = this.createTime(payment);
          if (now - createdAt > PAYME_TIMEOUT_MS) {
            // Отмену коммитим, ошибку бросаем после: throw внутри транзакции
            // откатил бы её вместе с собой.
            await this.cancelInTx(
              tx,
              payment,
              PAYME_STATE.cancelled,
              PAYME_CANCEL_REASON.timeout,
              now,
            );
            return { kind: 'timeout' as const };
          }

          return {
            kind: 'ok' as const,
            result: {
              create_time: createdAt,
              transaction: String(payment.id),
              state: PAYME_STATE.created,
              receivers: null,
            },
          };
        }

        // Другая транзакция уже держит этот заказ.
        if (payment.providerTransactionId) {
          throw PAYME_ERROR.cannotPerform('Заказ уже оплачивается');
        }

        const shop = await this.repository.lockShop(tx, payment.shopId);
        this.assertPayable(payment, shop?.status ?? 'gone', amountTiyin, now);

        const attached = await this.repository.attachPaymeTransaction(
          tx,
          payment.id,
          {
            providerTransactionId: transactionId,
            meta: {
              paymeState: PAYME_STATE.created,
              paymeTime,
              paymeCreateTime: now,
              paymeReason: null,
            },
          },
        );

        this.logger.log(
          `Payme завёл транзакцию ${transactionId} по счёту ${orderId} ` +
            `(магазин ${payment.shopId}, ${payment.amount} UZS)`,
        );

        return {
          kind: 'ok' as const,
          result: {
            create_time: now,
            transaction: String(attached.id),
            state: PAYME_STATE.created,
            receivers: null,
          },
        };
      },
    );

    if (outcome.kind === 'timeout') {
      this.logger.warn(
        `Транзакция Payme ${transactionId} отменена по таймауту при повторном CreateTransaction`,
      );
      throw PAYME_ERROR.cannotPerform('Истёк срок транзакции');
    }

    return outcome.result;
  }

  private async performTransaction(
    params: Record<string, unknown>,
  ): Promise<PerformResult> {
    const transactionId = paramTransactionId(params);
    const now = new Date();

    const outcome = await this.repository.transaction<PerformOutcome>(
      async (tx) => {
        const payment = await this.repository.lockByProviderTransaction(
          tx,
          'payme',
          transactionId,
        );
        if (!payment) throw PAYME_ERROR.transactionNotFound();

        const state = this.state(payment);

        if (state === PAYME_STATE.performed) {
          return {
            performed: false,
            result: {
              transaction: String(payment.id),
              perform_time: payment.meta?.paymePerformTime ?? 0,
              state: PAYME_STATE.performed,
            },
          };
        }

        if (state !== PAYME_STATE.created) {
          throw PAYME_ERROR.cannotPerform('Транзакция уже отменена');
        }

        if (now.getTime() - this.createTime(payment) > PAYME_TIMEOUT_MS) {
          // Отмена коммитится, ошибка уходит после выхода из транзакции.
          await this.cancelInTx(
            tx,
            payment,
            PAYME_STATE.cancelled,
            PAYME_CANCEL_REASON.timeout,
            now.getTime(),
          );
          return { performed: false, timedOut: true };
        }

        const shop = await this.repository.lockShop(tx, payment.shopId);
        if (!shop || shop.status !== 'active') {
          this.logger.error(
            `Payme Perform по магазину ${payment.shopId}, которого нет или он упразднён ` +
              `(transaction=${transactionId})`,
          );
          throw PAYME_ERROR.cannotPerform('Магазин недоступен');
        }

        const settled = await this.subscriptions.settlePaidOrder(
          tx,
          payment,
          shop,
          now,
        );
        if (settled.kind === 'mismatch') {
          throw PAYME_ERROR.cannotPerform(
            'Счёт нельзя закрыть выдачей подписки',
          );
        }

        await this.repository.patchMeta(tx, payment.id, {
          paymeState: PAYME_STATE.performed,
          paymePerformTime: now.getTime(),
        });

        return {
          performed: true,
          ownerId: settled.ownerId,
          payment: settled.payment,
          test: settled.test === true,
          result: {
            transaction: String(payment.id),
            perform_time: now.getTime(),
            state: PAYME_STATE.performed,
          },
        };
      },
    );

    if (!outcome.performed && 'timedOut' in outcome) {
      this.logger.warn(
        `Транзакция Payme ${transactionId} отменена по таймауту при PerformTransaction`,
      );
      throw PAYME_ERROR.cannotPerform('Истёк срок транзакции');
    }

    if (outcome.performed) {
      if (outcome.test) {
        this.logger.log(
          `Тестовая оплата Payme прошла: магазин ${outcome.payment.shopId}, ` +
            `платёж ${outcome.payment.id}, ${outcome.payment.amount} UZS. Подписка не выдавалась`,
        );
      } else {
        this.logger.log(
          `Подписка ${outcome.payment.plan.toUpperCase()} оплачена через Payme: ` +
            `магазин ${outcome.payment.shopId}, платёж ${outcome.payment.id}`,
        );
        this.subscriptions.notifyGranted(outcome.ownerId, outcome.payment);
      }
    }

    return outcome.result;
  }

  private async cancelTransaction(
    params: Record<string, unknown>,
  ): Promise<CancelResult> {
    const transactionId = paramTransactionId(params);
    const reason = paramReason(params) ?? PAYME_CANCEL_REASON.unknown;
    const now = Date.now();

    return this.repository.transaction<CancelResult>(async (tx) => {
      const payment = await this.repository.lockByProviderTransaction(
        tx,
        'payme',
        transactionId,
      );
      if (!payment) throw PAYME_ERROR.transactionNotFound();

      const state = this.state(payment);

      if (
        state === PAYME_STATE.cancelled ||
        state === PAYME_STATE.cancelledAfterPerform
      ) {
        return {
          transaction: String(payment.id),
          cancel_time: payment.meta?.paymeCancelTime ?? now,
          state,
        };
      }

      // Подписка уже выдана: услуга оказана, возврат — только руками.
      if (state === PAYME_STATE.performed) {
        this.logger.warn(
          `Payme просит отменить выполненную транзакцию ${transactionId} ` +
            `(платёж ${payment.id}, магазин ${payment.shopId}) — отвечаем -31007`,
        );
        throw PAYME_ERROR.cannotCancel();
      }

      const cancelled = await this.cancelInTx(
        tx,
        payment,
        PAYME_STATE.cancelled,
        reason,
        now,
      );

      this.logger.log(
        `Payme отменил транзакцию ${transactionId} по счёту ${payment.merchantBillingId} ` +
          `(причина ${reason})`,
      );

      return {
        transaction: String(cancelled.id),
        cancel_time: now,
        state: PAYME_STATE.cancelled,
      };
    });
  }

  private async cancelInTx(
    tx: Tx,
    payment: SubscriptionPayment,
    state: number,
    reason: number,
    now: number,
  ): Promise<SubscriptionPayment> {
    return this.repository.markCancelled(tx, payment.id, {
      paymeState: state,
      paymeReason: reason,
      paymeCancelTime: now,
    });
  }

  private async checkTransaction(
    params: Record<string, unknown>,
  ): Promise<CheckResult> {
    const transactionId = paramTransactionId(params);

    const payment = await this.repository.findPaymeByTransaction(transactionId);
    if (!payment) throw PAYME_ERROR.transactionNotFound();

    return this.describe(payment);
  }

  private describe(payment: SubscriptionPayment): CheckResult {
    return {
      create_time: this.createTime(payment),
      perform_time: payment.meta?.paymePerformTime ?? 0,
      cancel_time: payment.meta?.paymeCancelTime ?? 0,
      transaction: String(payment.id),
      state: this.state(payment),
      reason: payment.meta?.paymeReason ?? null,
    };
  }

  private async getStatement(
    params: Record<string, unknown>,
  ): Promise<StatementResult> {
    const from = paramTime(params, 'from');
    const to = paramTime(params, 'to');

    const payments = await this.repository.findPaymeStatement(from, to);
    const field = this.accountField();

    return {
      transactions: payments
        .filter((payment) => payment.providerTransactionId)
        .map((payment) => ({
          id: payment.providerTransactionId ?? '',
          time: payment.meta?.paymeTime ?? this.createTime(payment),
          amount: uzsToTiyin(payment.amount),
          account: { [field]: String(payment.merchantBillingId) },
          receivers: null,
          ...this.describe(payment),
        })),
    };
  }
}
