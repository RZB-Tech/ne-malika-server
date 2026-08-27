import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditsRepository,
  type ShopCredits,
  type SubscriptionGrantResult,
} from './credits.repository';
import { SettingsService } from '../settings/settings.service';
import type { CreditTxnMeta } from '../../db/schema';
import type { Tx } from '../../db/db.provider';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import {
  AUTOFILL_FREE_PER_MONTH,
  effectiveLimits,
  monthStart,
  type PaidPlan,
  type SubscriptionPlanId,
} from '../subscriptions/subscriptions.constants';
import {
  AUTOFILL_CREDITS,
  WELCOME_CREDITS,
  WELCOME_NOTE,
  WELCOME_PROMO,
  autofillCharge,
  nextMonthStart,
  sellerVisibleMeta,
  usdToCredits,
} from './credits.constants';

export interface CreditHold {
  shopId: number;
  credits: number;
}

export type AutofillHold =
  | { kind: 'platform' }
  | { kind: 'unlimited'; shopId: number }
  | { kind: 'free'; shopId: number; month: string; leftAfter: number }
  | { kind: 'paid'; hold: CreditHold };

export interface AutofillQuota {
  price: number;
  effectivePrice: number;
  free: boolean;
  unlimited: boolean;
  freeLeft: number | null;
  freeLimit: number;
  resetsAt: string | null;
  plan: SubscriptionPlanId;
  allowed: boolean;
  balance: number | null;
}

export interface SellerCreditTxn {
  id: number;
  kind: 'grant' | 'spend' | 'refund' | 'adjust';
  amount: number;
  balanceAfter: number;
  subscriptionAfter: number | null;
  note: string | null;
  meta: CreditTxnMeta | null;
  createdAt: Date;
}

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly repository: CreditsRepository,
    private readonly settings: SettingsService,
  ) {}

  shopIdOf(ownerId: number): Promise<number | undefined> {
    return this.repository.findShopIdByOwner(ownerId);
  }

  balance(shopId: number): Promise<ShopCredits | undefined> {
    return this.repository.find(shopId);
  }

  async available(shopId: number): Promise<number> {
    const state = await this.repository.find(shopId);
    return Math.max(0, state?.available ?? 0);
  }

  async history(shopId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.history(
      shopId,
      query,
    );
    return buildPaginatedResult(data, total, page, limit);
  }

  async historyForSeller(shopId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.history(
      shopId,
      query,
    );
    const safe: SellerCreditTxn[] = data.map((row) => ({
      ...row,
      meta: sellerVisibleMeta(row.meta),
    }));
    return buildPaginatedResult(safe, total, page, limit);
  }

  private async toCredits(usd: number): Promise<number> {
    const markup = await this.settings.getCreditMarkup();
    return usdToCredits(usd * markup);
  }

  async hold(
    author: { id: number; isAdmin: boolean },
    estimateUsd: number,
    what: string,
  ): Promise<CreditHold | null> {
    if (author.isAdmin) return null;
    return this.reserve(author.id, await this.toCredits(estimateUsd), what);
  }

  async holdFixed(
    author: { id: number; isAdmin: boolean },
    credits: number,
    what: string,
  ): Promise<CreditHold | null> {
    if (author.isAdmin) return null;
    return this.reserve(author.id, credits, what);
  }

  private async reserve(
    ownerId: number,
    credits: number,
    what: string,
  ): Promise<CreditHold> {
    const shopId = await this.repository.findShopIdByOwner(ownerId);
    if (!shopId) {
      throw new ForbiddenException(
        'Генерация доступна только владельцу активного магазина.',
      );
    }
    return this.reserveOn(shopId, credits, what);
  }

  private async reserveOn(
    shopId: number,
    credits: number,
    what: string,
  ): Promise<CreditHold> {
    if (await this.repository.reserve(shopId, credits)) {
      return { shopId, credits };
    }

    const available = await this.available(shopId);
    throw new ForbiddenException(
      available === 0
        ? 'Кредиты закончились. Обратитесь к администратору за пополнением.'
        : `Не хватает кредитов на ${what}: нужно ${credits}, доступно ${available}.`,
    );
  }

  async settle(
    hold: CreditHold | null,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<number> {
    if (!hold) return 0;

    const estimated = usd === undefined || usd <= 0;
    const credits = estimated ? hold.credits : await this.toCredits(usd);

    if (estimated) {
      this.logger.warn(
        `OpenRouter не вернул стоимость (${meta.operation ?? 'запрос'}, модель ${meta.model ?? '—'}) — списываем оценку ${hold.credits}`,
      );
    }

    try {
      await this.repository.spend(hold.shopId, hold.credits, credits, {
        ...meta,
        usd,
        estimated,
      });
      return credits;
    } catch (err) {
      this.logger.error(
        `Не удалось списать кредиты магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.repository.release(hold.shopId, hold.credits).catch(() => {});
      return 0;
    }
  }

  async settleFixed(
    hold: CreditHold | null,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<number> {
    if (!hold) return 0;

    try {
      await this.repository.spend(hold.shopId, hold.credits, hold.credits, {
        ...meta,
        usd,
        fixed: true,
      });
      return hold.credits;
    } catch (err) {
      this.logger.error(
        `Не удалось списать кредиты магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.repository.release(hold.shopId, hold.credits).catch(() => {});
      return 0;
    }
  }

  async cancel(hold: CreditHold | null): Promise<void> {
    if (!hold) return;
    await this.repository
      .release(hold.shopId, hold.credits)
      .catch((err: unknown) =>
        this.logger.error(
          `Не удалось снять резерв магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  async holdAutofill(author: {
    id: number;
    isAdmin: boolean;
  }): Promise<AutofillHold> {
    if (author.isAdmin) return { kind: 'platform' };

    const shop = await this.repository.findShopSubscriptionByOwner(author.id);
    if (!shop) {
      throw new ForbiddenException(
        'Генерация доступна только владельцу активного магазина.',
      );
    }

    const limits = effectiveLimits(shop);
    if (limits.freeAutofills === null) {
      return { kind: 'unlimited', shopId: shop.id };
    }

    if (limits.freeAutofills > 0) {
      const month = monthStart();
      const used = await this.repository.claimFreeAutofill(
        shop.id,
        month,
        limits.freeAutofills,
      );
      if (used !== undefined) {
        return {
          kind: 'free',
          shopId: shop.id,
          month,
          leftAfter: Math.max(0, limits.freeAutofills - used),
        };
      }
    }

    return {
      kind: 'paid',
      hold: await this.reserveOn(
        shop.id,
        AUTOFILL_CREDITS,
        'автозаполнение карточки',
      ),
    };
  }

  async settleAutofill(
    hold: AutofillHold,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<number> {
    if (hold.kind !== 'paid') return 0;
    return this.settleFixed(hold.hold, usd, meta);
  }

  async cancelAutofill(hold: AutofillHold): Promise<void> {
    if (hold.kind === 'paid') {
      await this.cancel(hold.hold);
      return;
    }
    if (hold.kind === 'free') {
      await this.repository
        .releaseFreeAutofill(hold.shopId, hold.month)
        .catch((err: unknown) =>
          this.logger.error(
            `Не удалось вернуть бесплатное автозаполнение магазину ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
  }

  async autofillQuota(ownerId: number): Promise<AutofillQuota> {
    const month = monthStart();
    const shop = await this.repository.findAutofillStateByOwner(ownerId, month);

    if (!shop) {
      return {
        price: AUTOFILL_CREDITS,
        effectivePrice: AUTOFILL_CREDITS,
        free: false,
        unlimited: false,
        freeLeft: null,
        freeLimit: AUTOFILL_FREE_PER_MONTH,
        resetsAt: null,
        plan: 'free',
        allowed: false,
        balance: 0,
      };
    }

    const limits = effectiveLimits(shop);
    const charge = autofillCharge(limits, shop.freeUsed);
    const available = Math.max(0, shop.available);
    const hasCounter =
      limits.freeAutofills !== null && limits.freeAutofills > 0;

    return {
      price: AUTOFILL_CREDITS,
      effectivePrice: charge === 'paid' ? AUTOFILL_CREDITS : 0,
      free: charge !== 'paid',
      unlimited: charge === 'unlimited',
      freeLeft: hasCounter
        ? Math.max(0, (limits.freeAutofills ?? 0) - shop.freeUsed)
        : null,
      freeLimit: AUTOFILL_FREE_PER_MONTH,
      resetsAt: hasCounter ? nextMonthStart(month) : null,
      plan: limits.id,
      allowed: charge !== 'paid' || available >= AUTOFILL_CREDITS,
      balance: available,
    };
  }

  async grant(
    shopId: number,
    authorId: number,
    paidUsd: number,
    note?: string,
  ): Promise<{ balance: number; credits: number; markup: number }> {
    const shop = await this.repository.find(shopId);
    if (!shop) throw new NotFoundException('Магазин не найден');

    const markup = await this.settings.getCreditMarkup();
    const credits = usdToCredits(paidUsd);

    const balance = await this.repository.grant({
      shopId,
      authorId,
      credits,
      note,
      meta: { paidUsd, markup },
    });

    this.logger.log(
      `Магазину ${shopId} начислено ${credits} кредитов (оплата $${paidUsd}, множитель ${markup})`,
    );
    return { balance, credits, markup };
  }

  grantSubscriptionCredits(
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
    return this.repository.grantSubscription(data, tx);
  }

  hasPaidSubscription(shopId: number): Promise<boolean> {
    return this.repository.hasPaidSubscription(shopId);
  }

  async grantWelcome(shopId: number): Promise<number> {
    if (await this.repository.hasPromo(shopId, WELCOME_PROMO)) {
      return 0;
    }

    await this.repository.grant({
      shopId,
      authorId: null,
      credits: WELCOME_CREDITS,
      note: WELCOME_NOTE,
      meta: { promo: WELCOME_PROMO },
    });

    this.logger.log(
      `Магазину ${shopId} начислено ${WELCOME_CREDITS} приветственных кредитов`,
    );
    return WELCOME_CREDITS;
  }

  async revoke(
    shopId: number,
    authorId: number,
    credits: number,
    note?: string,
  ): Promise<{ balance: number; taken: number }> {
    const shop = await this.repository.find(shopId);
    if (!shop) throw new NotFoundException('Магазин не найден');

    const result = await this.repository.revoke({
      shopId,
      authorId,
      credits,
      note,
    });

    this.logger.log(
      `У магазина ${shopId} снято ${result.taken} кредитов из запрошенных ${credits}, остаток ${result.balance}`,
    );
    return result;
  }

  async preview(paidUsd: number): Promise<{ credits: number; markup: number }> {
    const markup = await this.settings.getCreditMarkup();
    return { credits: usdToCredits(paidUsd), markup };
  }
}
