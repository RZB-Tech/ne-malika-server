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
import type {
  SubscriptionPayment,
  SubscriptionPaymentMeta,
} from '../../db/schema';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { createClickPaymentUrl } from './click-protocol';
import { ClickMerchantService } from './click-merchant.service';
import {
  SubscriptionsRepository,
  type PaymentShop,
} from './subscriptions.repository';
import {
  AUTOFILL_FREE_PER_MONTH,
  MANUAL_ACTIVATION_COOLDOWN_SEC,
  TEST_WINDOW_MINUTES,
  TZ,
  buildPlans,
  effectiveLimits,
  isPaidPlan,
  monthStart,
  type PaidPlan,
  type PlanSpec,
  type SubscriptionPlanId,
} from './subscriptions.constants';
import type { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import type { FindAdminSubscriptionsQueryDto } from './dto/find-admin-subscriptions-query.dto';
import type {
  AdminSubscriptionRowDto,
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
  | { kind: 'conflict' };

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

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
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
      this.logger.error(
        `Прайс подписки задан неверно: ${error instanceof Error ? error.message : String(error)}`,
      );
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

  planByAmount(amount: number): PaidPlan | null {
    const spec = this.specs.find((item) => sameAmount(item.priceUzs, amount));
    return spec ? spec.id : null;
  }

  private specOf(plan: PaidPlan): PlanSpec {
    const spec = this.specById.get(plan);
    if (!spec) throw new BadRequestException('Неизвестный тариф');
    return spec;
  }

  async resolvePurchase(
    shopId: number,
    amount: number,
  ): Promise<{ kind: 'plan'; plan: PaidPlan } | { kind: 'test' } | null> {
    const plan = this.planByAmount(amount);
    if (plan) return { kind: 'plan', plan };

    if (
      this.testPriceUzs > 0 &&
      sameAmount(this.testPriceUzs, amount) &&
      (await this.repository.isTestWindowOpen(shopId))
    ) {
      return { kind: 'test' };
    }

    return null;
  }

  async armTestCheckout(shopId: number): Promise<TestPaymentLinkDto> {
    this.requireClickConfigured();

    if (!(this.testPriceUzs > 0)) {
      throw new BadRequestException(
        'Тестовая сумма не задана: заполните SUBSCRIPTION_TEST_PRICE_UZS',
      );
    }

    const until = new Date(Date.now() + TEST_WINDOW_MINUTES * 60_000);
    const shop = await this.repository.armTestWindow(shopId, until);
    if (!shop) {
      throw new NotFoundException('Активный магазин не найден');
    }

    this.logger.log(
      `Открыто окно тестовой оплаты: магазин ${shop.id}, ${this.testPriceUzs} UZS, до ${until.toISOString()}`,
    );

    return {
      amountUzs: this.testPriceUzs,
      armedUntil: until.toISOString(),
      url: createClickPaymentUrl({
        serviceId: this.config.get<string>('click.serviceId')!,
        merchantId: this.config.get<string>('click.merchantId')!,
        amountUzs: this.testPriceUzs,
        transactionParam: String(shop.ownerTelegramId),
      }),
    };
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

  async checkout(ownerId: number, plan: PaidPlan): Promise<PaymentLinkDto> {
    const spec = this.specOf(plan);
    this.requireClickConfigured();

    const shop = await this.shopOfOwner(ownerId);

    return {
      provider: 'click',
      plan: spec.id,
      amountUzs: spec.priceUzs,
      url: createClickPaymentUrl({
        serviceId: this.config.get<string>('click.serviceId')!,
        merchantId: this.config.get<string>('click.merchantId')!,
        amountUzs: spec.priceUzs,
        transactionParam: String(shop.ownerTelegramId),
      }),
    };
  }

  async findShopForPayment(
    merchantTransId: string,
  ): Promise<PaymentShop | undefined> {
    const trimmed = merchantTransId.trim();
    if (!/^\d{5,18}$/.test(trimmed)) return undefined;

    const telegramId = Number(trimmed);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return undefined;

    return this.repository.findShopByOwnerTelegramId(telegramId);
  }

  async prepare(input: {
    shopId: number;
    plan: PaidPlan | null;
    amount: number;
    providerTransactionId: string;
    providerPaymentId: string;
    serviceId: string;
    signTime: string;
  }): Promise<PrepareResult> {
    const test = input.plan === null;
    const plan: SubscriptionPlanId = input.plan ?? 'free';

    return this.repository.transaction<PrepareResult>(async (tx) => {
      let payment = await this.repository.insertPrepared(tx, {
        shopId: input.shopId,
        plan,
        amount: input.amount,
        providerTransactionId: input.providerTransactionId,
        providerPaymentId: input.providerPaymentId,
        meta: {
          serviceId: input.serviceId,
          signTime: input.signTime,
          ...(test ? { test: true } : {}),
        },
      });

      if (!payment) {
        payment = await this.repository.lockByProviderTransaction(
          tx,
          input.providerTransactionId,
        );

        if (!payment) {
          this.logger.error(
            `Click: платёжный документ ${input.providerPaymentId} уже учтён под другим номером транзакции ` +
              `(click_trans_id=${input.providerTransactionId}, магазин ${input.shopId})`,
          );
          throw new ConflictException(
            'Платёжный документ уже учтён другим платежом',
          );
        }

        if (
          payment.shopId !== input.shopId ||
          payment.plan !== plan ||
          Boolean(payment.meta?.test) !== test ||
          payment.providerPaymentId !== input.providerPaymentId ||
          !sameAmount(payment.amount, input.amount)
        ) {
          this.logger.warn(
            `Click: повторный Prepare не сошёлся с сохранённым (click_trans_id=${input.providerTransactionId})`,
          );
          return { kind: 'conflict' };
        }

        if (payment.status === 'paid') return { kind: 'already_paid' };
        if (payment.status === 'cancelled') return { kind: 'cancelled' };
      }

      const prepareId = String(payment.merchantBillingId);
      if (payment.providerPrepareId !== prepareId) {
        payment = await this.repository.setPrepareId(tx, payment.id, prepareId);
      }

      return { kind: 'prepared', payment };
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

        if (payment.meta?.test) {
          await this.repository.closeTestWindow(tx, shop.id);

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
          plan: this.planByAmount(input.amount) ?? 'free',
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
          `${error instanceof Error ? error.message : String(error)}`,
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

    return {
      plan: limits.id,
      active,
      until,
      daysLeft:
        active && until
          ? Math.max(
              0,
              Math.ceil((until.getTime() - now.getTime()) / 86_400_000),
            )
          : null,
      subscriptionCredits: row.subscriptionCredits,
      creditsBalance: row.creditsBalance,
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
        daysLeft:
          active && row.until
            ? Math.max(
                0,
                Math.ceil((row.until.getTime() - now.getTime()) / 86_400_000),
              )
            : null,
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
      this.logger.error(
        `Не удалось выполнить ${what}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
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
