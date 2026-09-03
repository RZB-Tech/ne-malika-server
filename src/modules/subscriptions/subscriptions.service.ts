import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { PRODUCT_CACHE_PREFIX } from '../product-cards/product-cards.cache';
import { escapeHtml, excerpt } from '../bot/telegram-html';
import { nextMonthStart } from '../credits/credits.constants';
import type { Tx } from '../../db/db.provider';
import type {
  SubscriptionPayment,
  SubscriptionPaymentMeta,
} from '../../db/schema';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { createClickPaymentUrl } from './click-protocol';
import { createPaymeCheckoutUrl, uzsToTiyin } from './payme-protocol';
import {
  ClickMerchantService,
  normalizeUzPhone,
} from './click-merchant.service';
import {
  SubscriptionsRepository,
  type PaymentOrder,
  type PaymentProvider,
  type PaymentShop,
} from './subscriptions.repository';
import {
  AUTOFILL_FREE_PER_MONTH,
  MANUAL_ACTIVATION_COOLDOWN_SEC,
  ORDER_REUSE_MINUTES,
  PAID_PLANS,
  TEST_WINDOW_MINUTES,
  buildPlans,
  effectiveLimits,
  formatDate,
  isPaidPlan,
  monthStart,
  type PaidPlan,
  type PlanSpec,
  type SubscriptionPlanId,
} from './subscriptions.constants';
import { eachDay, shiftDay, today } from '../product-stats/product-stats.util';
import type {
  SubscriptionActivePlanDto,
  SubscriptionPlanSliceDto,
  SubscriptionProviderSliceDto,
  SubscriptionReportDto,
  SubscriptionSalesPointDto,
  SubscriptionStatusSliceDto,
} from './dto/subscription-report.dto';
import type { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { errorMessage } from '../../common/errors';
import type { FindAdminSubscriptionsQueryDto } from './dto/find-admin-subscriptions-query.dto';
import type {
  AdminSubscriptionRowDto,
  InvoiceDto,
  PaymentLinkDto,
  SellerSubscriptionDto,
  SubscriptionPaymentDto,
  SubscriptionPlanDto,
  TestPaymentLinkDto,
} from './dto/subscription.dto';

export type PrepareResult =
  | { kind: 'prepared'; payment: SubscriptionPayment }
  | { kind: 'already_paid' }
  | { kind: 'cancelled' }
  | { kind: 'not_found' }
  | { kind: 'invalid_amount' }
  | { kind: 'shop_gone' }
  | { kind: 'expired' }
  | { kind: 'conflict' };

export type SettleResult =
  | {
      kind: 'paid';
      payment: SubscriptionPayment;
      ownerId: number;
      shopName: string;
      test?: boolean;
    }
  | { kind: 'mismatch' };

export type CompleteResult =
  | {
      kind: 'paid';
      payment: SubscriptionPayment;
      ownerId: number;
      shopName: string;
      test?: boolean;
    }
  | { kind: 'already_paid' }
  | { kind: 'cancelled' }
  | { kind: 'not_found' }
  | { kind: 'mismatch' }
  | { kind: 'invalid_amount' }
  | { kind: 'shop_gone' };

function sameAmount(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

function daysLeftUntil(
  until: Date | null,
  now: Date,
  active: boolean,
): number | null {
  if (!active || !until) return null;
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  private specs: PlanSpec[] = [];
  private specById = new Map<PaidPlan, PlanSpec>();
  private testPriceUzs = 0;

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly credits: CreditsService,
    private readonly merchant: ClickMerchantService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const prices: Record<PaidPlan, number> = {
      start: this.config.get<number>('subscription.priceStartUzs') ?? 0,
      pro: this.config.get<number>('subscription.priceProUzs') ?? 0,
      max: this.config.get<number>('subscription.priceMaxUzs') ?? 0,
    };

    this.testPriceUzs =
      this.config.get<number>('subscription.testPriceUzs') ?? 0;

    try {
      this.specs = buildPlans(prices, this.testPriceUzs);
    } catch (error) {
      this.logger.error(`Прайс подписки задан неверно: ${errorMessage(error)}`);
      throw error;
    }

    this.specById = new Map(this.specs.map((spec) => [spec.id, spec]));
    this.logger.log(
      `Прайс подписки: ${this.specs
        .map((spec) => `${spec.id.toUpperCase()} ${spec.priceUzs} UZS`)
        .join(', ')}`,
    );
  }

  plans(): SubscriptionPlanDto[] {
    return this.specs.map((spec) => ({
      id: spec.id,
      priceUzs: spec.priceUzs,
      months: spec.months,
      credits: spec.credits,
      freeAutofills: spec.freeAutofills,
      promoted: spec.promoWeight > 1,
      bannerSlots: spec.bannerSlots,
      analyticsDays: spec.analyticsDays,
    }));
  }

  private specOf(plan: PaidPlan): PlanSpec {
    const spec = this.specById.get(plan);
    if (!spec) throw new BadRequestException('Неизвестный тариф');
    return spec;
  }

  /** Сколько живёт тестовый счёт провайдера. */
  testWindowMinutes(provider: PaymentProvider): number {
    return provider === 'payme'
      ? (this.config.get<number>('payme.sandboxTtlMin') ?? 720)
      : TEST_WINDOW_MINUTES;
  }

  /**
   * Фейковый счёт для проверки кассы: боевой заказ с тестовой суммой, который
   * ничего не выдаёт при оплате. Для Payme это же и есть заказ, номер и сумму
   * которого вбивают в песочницу.
   */
  async createTestCheckout(
    shopId: number,
    adminId: number,
    options: { provider?: PaymentProvider; amountUzs?: number } = {},
  ): Promise<TestPaymentLinkDto> {
    const provider = options.provider ?? 'click';
    this.requireProviderConfigured(provider);

    const amountUzs = options.amountUzs ?? this.testPriceUzs;

    if (!Number.isInteger(amountUzs) || amountUzs <= 0) {
      throw new BadRequestException(
        'Тестовая сумма не задана: заполните SUBSCRIPTION_TEST_PRICE_UZS либо укажите сумму в запросе',
      );
    }

    if (this.specs.some((spec) => spec.priceUzs === amountUzs)) {
      throw new BadRequestException(
        'Тестовая сумма совпадает с ценой тарифа — возьмите любую другую',
      );
    }

    const shop = await this.repository.findShopById(shopId);
    if (!shop) throw new NotFoundException('Активный магазин не найден');

    const windowMinutes = this.testWindowMinutes(provider);

    const order = await this.openOrder({
      shopId: shop.id,
      provider,
      plan: 'free',
      amount: amountUzs,
      initiatorId: adminId,
      test: true,
      reuseMinutes: windowMinutes,
    });

    this.logger.log(
      `Заведён счёт проверки кассы ${provider} ${order.merchantBillingId}: магазин ${shop.id}, ${amountUzs} UZS`,
    );

    return {
      provider,
      orderId: order.merchantBillingId,
      amountUzs,
      amountTiyin: uzsToTiyin(amountUzs),
      accountField: this.paymeAccountField(),
      merchantId:
        provider === 'payme'
          ? (this.paymeMerchantId() ?? null)
          : (this.config.get<string>('click.merchantId') ?? null),
      armedUntil: new Date(
        order.createdAt.getTime() + windowMinutes * 60_000,
      ).toISOString(),
      url: this.providerUrl(provider, amountUzs, order.merchantBillingId),
    };
  }

  async createInvoice(
    ownerId: number,
    plan: PaidPlan,
    phone: string,
  ): Promise<InvoiceDto> {
    const spec = this.specOf(plan);
    this.requireClickConfigured();

    if (!this.merchant.isConfigured()) {
      this.logger.error(
        'Счёт на телефон запрошен без реквизитов Merchant API: нет CLICK_MERCHANT_USER_ID',
      );
      throw new ServiceUnavailableException(
        'Оплата по номеру телефона временно недоступна',
      );
    }

    const normalized = normalizeUzPhone(phone);
    if (!normalized) throw new BadRequestException('Неверный номер телефона');

    const shop = await this.shopOfOwner(ownerId);

    const order = await this.openOrder({
      shopId: shop.id,
      provider: 'click',
      plan: spec.id,
      amount: spec.priceUzs,
      initiatorId: ownerId,
      test: false,
    });

    const invoice = await this.merchant.createInvoice({
      phone: normalized,
      amountUzs: spec.priceUzs,
      merchantTransId: String(order.merchantBillingId),
    });

    if (!invoice.ok) {
      throw new ServiceUnavailableException(
        'Не удалось выставить счёт — попробуйте оплатить по ссылке',
      );
    }

    await this.repository.patchOrderMeta(order.id, {
      invoiceId: invoice.invoiceId,
      invoicePhone: normalized,
    });

    return {
      invoiceId: invoice.invoiceId,
      orderId: order.merchantBillingId,
      plan: spec.id,
      amountUzs: spec.priceUzs,
      phone: normalized,
      status: 'pending',
    };
  }

  async invoiceState(ownerId: number, orderId: number): Promise<InvoiceDto> {
    const order = await this.repository.findOwnOrder(ownerId, orderId);
    if (!order) throw new NotFoundException('Счёт не найден');

    const invoiceId = order.meta?.invoiceId;
    if (!invoiceId) throw new NotFoundException('Счёт не выставлялся');

    if (order.status !== 'paid' && order.status !== 'cancelled') {
      const state = await this.merchant.invoiceState(invoiceId);
      if (state.ok) {
        this.logger.log(
          `Счёт Click ${invoiceId} (заказ ${orderId}): статус ${state.status} — ${state.note}`,
        );
      }
    }

    return {
      invoiceId,
      orderId: order.merchantBillingId,
      plan: isPaidPlan(order.plan) ? order.plan : 'start',
      amountUzs: order.amount,
      phone: order.meta?.invoicePhone ?? '',
      status:
        order.status === 'paid'
          ? 'paid'
          : order.status === 'cancelled'
            ? 'cancelled'
            : 'pending',
    };
  }

  private payUrl(amountUzs: number, merchantBillingId: number): string {
    return createClickPaymentUrl({
      serviceId: this.config.get<string>('click.serviceId')!,
      merchantId: this.config.get<string>('click.merchantId')!,
      amountUzs,
      transactionParam: String(merchantBillingId),
    });
  }

  /** Имя поля account, под которым касса Payme ждёт номер заказа. */
  paymeAccountField(): string {
    return this.config.get<string>('payme.accountField') ?? 'order_id';
  }

  paymeMerchantId(): string | undefined {
    return this.config.get<string>('payme.merchantId');
  }

  private paymeUrl(amountUzs: number, merchantBillingId: number): string {
    return createPaymeCheckoutUrl({
      checkoutUrl: this.config.get<string>('payme.checkoutUrl')!,
      merchantId: this.config.get<string>('payme.merchantId')!,
      accountField: this.paymeAccountField(),
      orderId: merchantBillingId,
      amountTiyin: uzsToTiyin(amountUzs),
    });
  }

  private providerUrl(
    provider: PaymentProvider,
    amountUzs: number,
    merchantBillingId: number,
  ): string {
    return provider === 'payme'
      ? this.paymeUrl(amountUzs, merchantBillingId)
      : this.payUrl(amountUzs, merchantBillingId);
  }

  private requirePaymeConfigured(): void {
    const configured = Boolean(
      this.config.get<string>('payme.merchantId') &&
      this.config.get<string>('payme.key'),
    );

    if (!configured) {
      this.logger.error(
        'Оплата через Payme запрошена, но касса не настроена: нет PAYME_MERCHANT_ID / PAYME_KEY',
      );
      throw new ServiceUnavailableException(
        'Оплата через Payme временно недоступна',
      );
    }
  }

  private requireProviderConfigured(provider: PaymentProvider): void {
    if (provider === 'payme') {
      this.requirePaymeConfigured();
      return;
    }
    this.requireClickConfigured();
  }

  private async openOrder(input: {
    shopId: number;
    provider: PaymentProvider;
    plan: SubscriptionPlanId;
    amount: number;
    initiatorId: number | null;
    test: boolean;
    reuseMinutes?: number;
  }): Promise<SubscriptionPayment> {
    const reuseMinutes = input.reuseMinutes ?? ORDER_REUSE_MINUTES;
    const since = new Date(Date.now() - reuseMinutes * 60_000);
    const existing = await this.repository.findReusableOrder({
      shopId: input.shopId,
      provider: input.provider,
      plan: input.plan,
      amount: input.amount,
      test: input.test,
      since,
    });
    if (existing) return existing;

    return this.repository.createOrder({
      shopId: input.shopId,
      provider: input.provider,
      plan: input.plan,
      amount: input.amount,
      initiatorId: input.initiatorId,
      meta: input.test ? { test: true } : {},
    });
  }

  private requireClickConfigured(): void {
    const configured = Boolean(
      this.config.get<string>('click.serviceId') &&
      this.config.get<string>('click.merchantId') &&
      this.config.get<string>('click.secretKey'),
    );

    if (!configured) {
      this.logger.error(
        'Оплата подписки запрошена, но Click не настроен: нет CLICK_SERVICE_ID / CLICK_MERCHANT_ID / CLICK_SECRET_KEY',
      );
      throw new ServiceUnavailableException(
        'Оплата подписки временно недоступна',
      );
    }

    if (
      this.config.get<string>('env') === 'production' &&
      !this.merchant.isConfigured()
    ) {
      this.logger.error(
        'Оплата подписки запрошена в production без реквизитов Merchant API: вернуть деньги при неудачной выдаче будет нечем',
      );
      throw new ServiceUnavailableException(
        'Оплата подписки временно недоступна',
      );
    }
  }

  async checkout(
    ownerId: number,
    plan: PaidPlan,
    provider: PaymentProvider = 'click',
  ): Promise<PaymentLinkDto> {
    const spec = this.specOf(plan);
    this.requireProviderConfigured(provider);

    const shop = await this.shopOfOwner(ownerId);

    const order = await this.openOrder({
      shopId: shop.id,
      provider,
      plan: spec.id,
      amount: spec.priceUzs,
      initiatorId: ownerId,
      test: false,
    });

    return {
      provider,
      plan: spec.id,
      amountUzs: spec.priceUzs,
      url: this.providerUrl(provider, spec.priceUzs, order.merchantBillingId),
    };
  }

  async findOrderForPayment(
    merchantTransId: string,
  ): Promise<PaymentOrder | undefined> {
    const trimmed = merchantTransId.trim();
    if (!/^\d{1,10}$/.test(trimmed)) return undefined;

    const billingId = Number(trimmed);
    if (billingId <= 0) return undefined;

    return this.repository.findOrderForPayment(billingId);
  }

  async findOrderByAmount(amount: number): Promise<PaymentOrder | undefined> {
    if (!(amount > 0)) return undefined;

    const since = new Date(Date.now() - ORDER_REUSE_MINUTES * 60_000);
    const order = await this.repository.findSolePendingByAmount(amount, since);

    if (order) {
      this.logger.warn(
        `Click прислал Prepare без номера заказа: подобран единственный неоплаченный счёт ` +
          `${order.merchantBillingId} на ${amount} UZS (магазин ${order.shopId})`,
      );
    } else {
      this.logger.error(
        `Click прислал Prepare без номера заказа, и подобрать его нельзя: ` +
          `на ${amount} UZS нет ровно одного неоплаченного счёта за последние ${ORDER_REUSE_MINUTES} мин`,
      );
    }

    return order;
  }

  async prepare(input: {
    orderId: number;
    amount: number;
    providerTransactionId: string;
    providerPaymentId: string;
    serviceId: string;
    signTime: string;
  }): Promise<PrepareResult> {
    return this.repository.transaction<PrepareResult>(async (tx) => {
      const payment = await this.repository.lockByBillingId(tx, input.orderId);
      if (!payment) return { kind: 'not_found' };

      if (!sameAmount(payment.amount, input.amount)) {
        this.logger.warn(
          `Prepare Click с суммой не по счёту ${input.orderId}: ожидалось ${payment.amount}, пришло ${input.amount}`,
        );
        return { kind: 'invalid_amount' };
      }

      const shop = await this.repository.lockShop(tx, payment.shopId);
      if (!shop || shop.status !== 'active') return { kind: 'shop_gone' };

      if (payment.status === 'paid') return { kind: 'already_paid' };
      if (payment.status === 'cancelled') return { kind: 'cancelled' };

      if (payment.meta?.test) {
        const deadline =
          payment.createdAt.getTime() + TEST_WINDOW_MINUTES * 60_000;
        if (Date.now() > deadline) {
          this.logger.warn(
            `Prepare Click по просроченному счёту проверки кассы ${input.orderId}`,
          );
          return { kind: 'expired' };
        }
      }

      if (payment.status === 'prepared') {
        if (payment.providerTransactionId !== input.providerTransactionId) {
          this.logger.warn(
            `Prepare Click по уже занятому счёту ${input.orderId}: ` +
              `он ждёт транзакцию ${payment.providerTransactionId ?? '—'}, пришла ${input.providerTransactionId}`,
          );
          return { kind: 'conflict' };
        }
        return { kind: 'prepared', payment };
      }

      const attached = await this.repository.attachClickToOrder(
        tx,
        payment.id,
        {
          providerTransactionId: input.providerTransactionId,
          providerPaymentId: input.providerPaymentId,
          providerPrepareId: String(payment.merchantBillingId),
          meta: { serviceId: input.serviceId, signTime: input.signTime },
        },
      );

      return { kind: 'prepared', payment: attached };
    });
  }

  async complete(input: {
    shopId: number;
    providerTransactionId: string;
    providerPaymentId: string;
    merchantPrepareId: string;
    amount: number;
    clickError: number;
    errorNote?: string;
    signTime?: string;
  }): Promise<CompleteResult> {
    const now = new Date();

    const result = await this.repository.transaction<CompleteResult>(
      async (tx) => {
        const payment = await this.repository.lockByProviderTransaction(
          tx,
          'click',
          input.providerTransactionId,
        );
        if (!payment) return { kind: 'not_found' };

        const expectedPrepareId =
          payment.providerPrepareId ?? String(payment.merchantBillingId);

        if (
          payment.shopId !== input.shopId ||
          payment.providerPaymentId !== input.providerPaymentId ||
          expectedPrepareId !== input.merchantPrepareId
        ) {
          this.logger.error(
            `Click Complete с чужими реквизитами: click_trans_id=${input.providerTransactionId}, ` +
              `click_paydoc_id=${input.providerPaymentId}, merchant_prepare_id=${input.merchantPrepareId}, ` +
              `магазин из колбэка ${input.shopId}, магазин платежа ${payment.shopId}`,
          );
          return { kind: 'mismatch' };
        }

        if (!sameAmount(payment.amount, input.amount)) {
          this.logger.error(
            `Click Complete с другой суммой: ожидалось ${payment.amount}, пришло ${input.amount} ` +
              `(click_trans_id=${input.providerTransactionId})`,
          );
          return { kind: 'invalid_amount' };
        }

        if (input.clickError < 0) {
          const patch: SubscriptionPaymentMeta = {
            error: input.clickError,
            errorNote: input.errorNote,
            signTime: input.signTime,
          };

          if (payment.status === 'paid') {
            await this.repository.patchMeta(tx, payment.id, {
              ...patch,
              refundedByProvider: true,
              needsManualReview: true,
            });
            this.logger.error(
              `Click вернул уже оплаченную подписку: click_trans_id=${input.providerTransactionId}, ` +
                `click_paydoc_id=${input.providerPaymentId}, платёж ${payment.id}, магазин ${payment.shopId}. ` +
                'Период не отозван — требуется решение администратора',
            );
            return { kind: 'cancelled' };
          }

          await this.repository.markCancelled(tx, payment.id, patch);
          return { kind: 'cancelled' };
        }

        if (payment.status === 'paid') return { kind: 'already_paid' };
        if (payment.status === 'cancelled') return { kind: 'cancelled' };

        const shop = await this.repository.lockShop(tx, payment.shopId);
        if (!shop || shop.status !== 'active') {
          this.logger.error(
            `Click Complete по магазину ${payment.shopId}, которого нет или он упразднён ` +
              `(click_trans_id=${input.providerTransactionId})`,
          );
          return { kind: 'shop_gone' };
        }

        return this.settlePaidOrder(tx, payment, shop, now);
      },
    );

    if (result.kind === 'paid') {
      if (result.test) {
        this.logger.log(
          `Тестовая оплата прошла: магазин ${result.payment.shopId}, платёж ${result.payment.id}, ` +
            `${result.payment.amount} UZS. Подписка не выдавалась, окно закрыто`,
        );
        return result;
      }

      this.logger.log(
        `Подписка ${result.payment.plan.toUpperCase()} оплачена: магазин ${result.payment.shopId}, ` +
          `платёж ${result.payment.id}, до ${result.payment.activatedUntil?.toISOString() ?? '—'}`,
      );
      this.announceGranted(result.ownerId, result.payment);
    }

    return result;
  }

  /**
   * Выдача оплаченного счёта — общая часть для всех провайдеров. Зовётся
   * внутри транзакции, когда провайдер подтвердил списание: тестовый счёт
   * просто закрывается, боевой выдаёт период и кредиты.
   */
  async settlePaidOrder(
    tx: Tx,
    payment: SubscriptionPayment,
    shop: { id: number; name: string; owner: number },
    now: Date,
  ): Promise<SettleResult> {
    if (payment.meta?.test) {
      const updated = await this.repository.markPaid(tx, payment.id, {
        activatedFrom: null,
        activatedUntil: null,
        grantedCredits: 0,
        burnedCredits: 0,
        paidAt: now,
      });

      return {
        kind: 'paid',
        payment: updated,
        ownerId: shop.owner,
        shopName: shop.name,
        test: true,
      };
    }

    if (!isPaidPlan(payment.plan)) {
      this.logger.error(
        `Платёж ${payment.id} записан с непокупаемым тарифом «${payment.plan}» — выдавать нечего`,
      );
      return { kind: 'mismatch' };
    }
    const spec = this.specOf(payment.plan);

    const grant = await this.credits.grantSubscriptionCredits(
      {
        shopId: shop.id,
        plan: spec.id,
        months: spec.months,
        credits: spec.credits,
        paymentId: payment.id,
        now,
      },
      tx,
    );

    const updated = await this.repository.markPaid(tx, payment.id, {
      activatedFrom: grant.from,
      activatedUntil: grant.until,
      grantedCredits: grant.granted,
      burnedCredits: grant.burned,
      paidAt: now,
    });

    return {
      kind: 'paid',
      payment: updated,
      ownerId: shop.owner,
      shopName: shop.name,
    };
  }

  /** Сообщить продавцу о выданной подписке. Зовётся после коммита. */
  notifyGranted(ownerId: number, payment: SubscriptionPayment): void {
    this.announceGranted(ownerId, payment);
  }

  async recordFailedComplete(input: {
    shopId: number | null;
    providerTransactionId: string;
    providerPaymentId: string;
    amount: number;
    clickError?: number;
    errorNote: string;
    reversed: boolean;
    reversalNote?: string;
  }): Promise<void> {
    const meta: SubscriptionPaymentMeta = {
      error: input.clickError,
      errorNote: excerpt(input.errorNote, 500),
      reversed: input.reversed,
      reversalNote: input.reversalNote,
      needsManualReview: !input.reversed,
    };

    try {
      await this.repository.transaction(async (tx) => {
        const existing = await this.repository.lockByProviderTransaction(
          tx,
          'click',
          input.providerTransactionId,
        );

        if (existing) {
          if (existing.status === 'paid') {
            await this.repository.patchMeta(tx, existing.id, {
              ...meta,
              needsManualReview: true,
            });
            this.logger.error(
              `Отказ Complete по уже оплаченному платежу ${existing.id}: ` +
                `click_trans_id=${input.providerTransactionId}, click_paydoc_id=${input.providerPaymentId}`,
            );
            return;
          }

          await this.repository.markCancelled(tx, existing.id, meta);
          return;
        }

        if (input.shopId === null) {
          this.logger.error(
            `Отказ Complete без разрешённого магазина: click_trans_id=${input.providerTransactionId}, ` +
              `click_paydoc_id=${input.providerPaymentId}, сумма ${input.amount}, возврат ${input.reversed ? 'выполнен' : 'НЕ выполнен'}`,
          );
          return;
        }

        if (!(input.amount > 0)) {
          this.logger.error(
            `Отказ Complete с неразобранной суммой: click_trans_id=${input.providerTransactionId}, ` +
              `click_paydoc_id=${input.providerPaymentId}, магазин ${input.shopId}, ` +
              `возврат ${input.reversed ? 'выполнен' : 'НЕ выполнен'}`,
          );
          return;
        }

        const inserted = await this.repository.insertCancelled(tx, {
          shopId: input.shopId,
          plan: 'free',
          amount: input.amount,
          providerTransactionId: input.providerTransactionId,
          providerPaymentId: input.providerPaymentId,
          meta,
        });

        if (!inserted) {
          this.logger.error(
            `Строку об отказе Complete записать не удалось — номер занят: ` +
              `click_trans_id=${input.providerTransactionId}, click_paydoc_id=${input.providerPaymentId}`,
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Не удалось записать отказ Complete (click_trans_id=${input.providerTransactionId}): ` +
          `${errorMessage(error)}`,
      );
    }
  }

  private async shopOfOwner(ownerId: number): Promise<PaymentShop> {
    const shop = await this.repository.findShopByOwner(ownerId);
    if (!shop) {
      throw new ForbiddenException(
        'Подписка доступна только владельцу активного магазина',
      );
    }
    return shop;
  }

  async stateForOwner(ownerId: number): Promise<SellerSubscriptionDto> {
    const shop = await this.shopOfOwner(ownerId);
    return this.stateOf(shop.id);
  }

  async paymentsForOwner(ownerId: number, query: PaginationQueryDto) {
    const shop = await this.shopOfOwner(ownerId);
    return this.payments(shop.id, query);
  }

  async stateOf(shopId: number): Promise<SellerSubscriptionDto> {
    const month = monthStart();
    const row = await this.repository.stateOf(shopId, month);
    if (!row) throw new NotFoundException('Магазин не найден');

    const now = new Date();
    const limits = effectiveLimits(row, now);
    const active = limits.id !== 'free';
    const until = row.subscriptionUntil;

    const hasCounter =
      limits.freeAutofills !== null && limits.freeAutofills > 0;
    const left = hasCounter
      ? Math.max(0, (limits.freeAutofills ?? 0) - row.autofillUsed)
      : null;

    const totalBalance = (row.creditsBalance ?? 0) + (row.subscriptionCredits ?? 0);
    return {
      plan: limits.id,
      active,
      until,
      daysLeft: daysLeftUntil(until, now, active),
      subscriptionCredits: 0,
      creditsBalance: totalBalance,
      creditsReserved: row.creditsReserved,
      available: Math.max(0, row.available),
      autofill: {
        free: limits.freeAutofills === null || (left ?? 0) > 0,
        unlimited: limits.freeAutofills === null,
        left,
        limit: AUTOFILL_FREE_PER_MONTH,
        resetsAt: nextMonthStart(month),
      },
      bannerSlots: limits.bannerSlots,
      analyticsDays: limits.analyticsDays,
      promoted: limits.promoWeight > 1,
    };
  }

  async payments(shopId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.paymentsOf(
      shopId,
      query,
    );
    return buildPaginatedResult(data.map(toPaymentDto), total, page, limit);
  }

  /**
   * Отчёт по продажам подписок за последние `days` суток.
   *
   * Выручка и оплаты считаются по дате оплаты, а разбивка по состояниям счётов —
   * по дате выставления: счёт, выставленный вчера и оплаченный сегодня, попадёт
   * в разные сутки этих двух рядов. Иначе доходимость до оплаты не посчитать.
   */
  async adminReport(days: number): Promise<SubscriptionReportDto> {
    const to = today();
    const from = shiftDay(to, -(days - 1));

    const [
      byDay,
      planSlices,
      providerSlices,
      statusSlices,
      totals,
      top,
      active,
    ] = await Promise.all([
      this.repository.salesByDay(from, to),
      this.repository.salesByPlan(from, to),
      this.repository.salesByProvider(from, to),
      this.repository.invoicesByStatus(from, to),
      this.repository.salesTotals(from, to),
      this.repository.topShopsByRevenue(from, to, TOP_SHOPS_LIMIT),
      this.repository.activeShopsByPlan(),
    ]);

    const perDay = new Map<string, SubscriptionSalesPointDto>();
    for (const row of byDay) {
      const point = perDay.get(row.day) ?? emptySalesPoint(row.day);
      point.revenue += row.revenue;
      point.payments += row.payments;
      if (isPaidPlan(row.plan)) point[row.plan] += row.revenue;
      perDay.set(row.day, point);
    }

    const daily = eachDay(from, to).map(
      (date) => perDay.get(date) ?? emptySalesPoint(date),
    );

    // Тарифы идут своим порядком start → pro → max: он же порядок градаций
    // на графике, поэтому сортировать их по выручке нельзя.
    const byPlan: SubscriptionPlanSliceDto[] = PAID_PLANS.map((plan) => {
      const slice = planSlices.find((s) => s.key === plan);
      return {
        plan,
        payments: slice?.payments ?? 0,
        revenue: slice?.revenue ?? 0,
      };
    });

    const byProvider: SubscriptionProviderSliceDto[] = providerSlices.map(
      (slice) => ({
        provider: slice.key,
        payments: slice.payments,
        revenue: slice.revenue,
      }),
    );

    const byStatus: SubscriptionStatusSliceDto[] = INVOICE_STATUS_ORDER.map(
      (status) => ({
        status,
        payments:
          statusSlices.find((slice) => slice.key === status)?.payments ?? 0,
      }),
    ).filter((slice) => slice.payments > 0);

    const activeByPlan: SubscriptionActivePlanDto[] = PAID_PLANS.map(
      (plan) => ({
        plan,
        shops: active.find((row) => row.plan === plan)?.shops ?? 0,
      }),
    );

    const revenue = sumBy(daily, (point) => point.revenue);
    const payments = sumBy(daily, (point) => point.payments);
    const invoices = statusSlices.reduce(
      (acc, slice) => acc + slice.payments,
      0,
    );
    const paidInvoices =
      statusSlices.find((slice) => slice.key === 'paid')?.payments ?? 0;

    return {
      daily,
      byPlan,
      byProvider,
      byStatus,
      topShops: top,
      activeByPlan,
      revenue,
      payments,
      avgCheck: payments === 0 ? 0 : Math.round(revenue / payments),
      payingShops: totals.payingShops,
      newRevenue: totals.newRevenue,
      renewalRevenue: totals.renewalRevenue,
      activeShops: sumBy(activeByPlan, (row) => row.shops),
      conversion:
        invoices === 0 ? 0 : Math.round((paidInvoices / invoices) * 100),
      excludedTest: totals.testPayments,
      excludedRefunded: totals.refundedPayments,
    };
  }

  async adminList(query: FindAdminSubscriptionsQueryDto) {
    const { data, total, page, limit } = await this.repository.adminList(query);
    const now = new Date();

    const rows: AdminSubscriptionRowDto[] = data.map((row) => {
      const limits = effectiveLimits(
        {
          subscriptionPlan: row.storedPlan,
          subscriptionUntil: row.until,
        },
        now,
      );
      const active = limits.id !== 'free';

      return {
        shopId: row.shopId,
        shopName: row.shopName,
        shopStatus: row.shopStatus,
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        ownerUsername: row.ownerUsername,
        plan: limits.id,
        storedPlan: row.storedPlan,
        active,
        until: row.until,
        daysLeft: daysLeftUntil(row.until, now, active),
        subscriptionCredits: row.subscriptionCredits,
        lastPaidAt: row.lastPaidAt,
        stuckPrepared: row.stuckPrepared,
        needsManualReview: row.needsManualReview,
      };
    });

    return buildPaginatedResult(rows, total, page, limit);
  }

  async adminActivate(
    shopId: number,
    adminId: number,
    dto: ActivateSubscriptionDto,
  ): Promise<SellerSubscriptionDto> {
    const spec = this.specOf(dto.plan);
    const months = dto.months ?? 1;
    const now = new Date();

    const granted = await this.repository.transaction(async (tx) => {
      const shop = await this.repository.lockShop(tx, shopId);
      if (!shop) throw new NotFoundException('Магазин не найден');
      if (shop.status !== 'active') {
        throw new ConflictException(
          'Магазин упразднён — подписку выдавать нечему',
        );
      }

      if (
        await this.repository.hasRecentManual(
          tx,
          shopId,
          MANUAL_ACTIVATION_COOLDOWN_SEC,
        )
      ) {
        throw new ConflictException(
          'Подписка этому магазину уже выдана только что — повторите через минуту',
        );
      }

      const payment = await this.repository.insertManual(tx, {
        shopId,
        plan: spec.id,
        amount: spec.priceUzs * months,
        initiatorId: adminId,
        paidAt: now,
        meta: { adminId, note: dto.note },
      });

      const result = await this.credits.grantSubscriptionCredits(
        {
          shopId,
          plan: spec.id,
          months,
          credits: spec.credits * months,
          paymentId: payment.id,
          now,
        },
        tx,
      );

      return { ownerId: shop.owner, result };
    });

    this.logger.log(
      `Администратор ${adminId} выдал магазину ${shopId} подписку ${spec.id.toUpperCase()} ` +
        `на ${months} мес. до ${granted.result.until.toISOString()}`,
    );

    this.announceManual(
      shopId,
      granted.ownerId,
      `Администратор активировал подписку <b>${spec.id.toUpperCase()}</b> до ${formatDate(granted.result.until)}. ` +
        `Начислено ${granted.result.granted} кредитов на ИИ.`,
      'Подписка активирована',
    );

    return this.stateOf(shopId);
  }

  async adminCancel(
    shopId: number,
    adminId: number,
    reason: string,
  ): Promise<SellerSubscriptionDto> {
    const now = new Date();

    const cancelled = await this.repository.transaction(async (tx) => {
      const shop = await this.repository.lockShop(tx, shopId);
      if (!shop) throw new NotFoundException('Магазин не найден');
      if (!shop.subscriptionUntil || shop.subscriptionUntil <= now) {
        throw new ConflictException('У магазина нет действующей подписки');
      }

      await this.repository.expireSubscription(tx, shopId, now);

      await this.repository.insertManual(tx, {
        shopId,
        plan: shop.subscriptionPlan,
        amount: 1,
        initiatorId: adminId,
        paidAt: now,
        activatedFrom: now,
        activatedUntil: now,
        grantedCredits: 0,
        burnedCredits: 0,
        meta: { adminId, note: `Отмена подписки: ${excerpt(reason, 200)}` },
      });

      return { ownerId: shop.owner, plan: shop.subscriptionPlan };
    });

    this.logger.warn(
      `Администратор ${adminId} отменил подписку магазина ${shopId} (${cancelled.plan}): ${excerpt(reason, 200)}`,
    );

    this.announceManual(
      shopId,
      cancelled.ownerId,
      `Подписка отменена администратором. Причина: ${escapeHtml(excerpt(reason, 300))}`,
      'Подписка отменена',
    );

    return this.stateOf(shopId);
  }

  private announceGranted(ownerId: number, payment: SubscriptionPayment): void {
    const shopId = payment.shopId;
    const until = payment.activatedUntil;
    const plan = payment.plan.toUpperCase();
    const granted = payment.grantedCredits ?? 0;
    const burned = payment.burnedCredits ?? 0;

    const text =
      `Подписка <b>${plan}</b> оплачена${until ? ` и действует до ${formatDate(until)}` : ''}. ` +
      `Начислено ${granted} кредитов на ИИ.` +
      (burned > 0
        ? ` Неиспользованный остаток прошлого периода (${burned}) сгорел.`
        : '');

    this.fireAndForget(
      this.redis.delByPrefix(PRODUCT_CACHE_PREFIX),
      `сброс кэша каталога после оплаты подписки магазина ${shopId}`,
    );
    this.fireAndForget(
      this.notifications.notifyUser(ownerId, text),
      `уведомление владельца ${ownerId} об оплате подписки`,
    );
    this.fireAndForget(
      this.notifications.pushToUser(ownerId, {
        title: `Подписка ${plan} активна`,
        body: until
          ? `Оплачено до ${formatDate(until)}. Начислено ${granted} кредитов.`
          : `Начислено ${granted} кредитов.`,
        url: '/seller/subscription',
        tag: `subscription-${shopId}`,
      }),
      `push владельцу ${ownerId} об оплате подписки`,
    );
  }

  private announceManual(
    shopId: number,
    ownerId: number,
    text: string,
    pushTitle: string,
  ): void {
    this.fireAndForget(
      this.redis.delByPrefix(PRODUCT_CACHE_PREFIX),
      `сброс кэша каталога после ручного изменения подписки магазина ${shopId}`,
    );
    this.fireAndForget(
      this.notifications.notifyUser(ownerId, text),
      `уведомление владельца ${ownerId} об изменении подписки`,
    );
    this.fireAndForget(
      this.notifications.pushToUser(ownerId, {
        title: pushTitle,
        body: text.replaceAll(/<\/?b>/g, ''),
        url: '/seller/subscription',
        tag: `subscription-${shopId}`,
      }),
      `push владельцу ${ownerId} об изменении подписки`,
    );
  }

  private fireAndForget(promise: Promise<unknown>, what: string): void {
    void promise.catch((error: unknown) =>
      this.logger.error(`Не удалось выполнить ${what}: ${errorMessage(error)}`),
    );
  }
}

const TOP_SHOPS_LIMIT = 8;

/** Порядок для чтения: чем кончились счёта — от успеха к провалу. */
const INVOICE_STATUS_ORDER = [
  'paid',
  'prepared',
  'pending',
  'cancelled',
  'failed',
] as const;

function emptySalesPoint(date: string): SubscriptionSalesPointDto {
  return { date, revenue: 0, payments: 0, start: 0, pro: 0, max: 0 };
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

function toPaymentDto(payment: SubscriptionPayment): SubscriptionPaymentDto {
  const meta = payment.meta ?? {};
  return {
    id: payment.id,
    provider: payment.provider,
    plan: payment.plan,
    amount: payment.amount,
    status: payment.status,
    merchantBillingId: payment.merchantBillingId,
    activatedFrom: payment.activatedFrom,
    activatedUntil: payment.activatedUntil,
    grantedCredits: payment.grantedCredits,
    burnedCredits: payment.burnedCredits,
    paidAt: payment.paidAt,
    cancelledAt: payment.cancelledAt,
    createdAt: payment.createdAt,
    note: meta.note ?? null,
    errorNote: meta.errorNote ?? null,
    reversed: meta.reversed === true,
    refundedByProvider: meta.refundedByProvider === true,
    needsManualReview: meta.needsManualReview === true,
  };
}
