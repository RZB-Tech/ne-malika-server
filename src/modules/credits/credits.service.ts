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

/**
 * Занятый под запрос резерв. Возвращается из `reserve` и передаётся в
 * `settle`, чтобы вызывающий не пересчитывал сумму заново.
 */
export interface CreditHold {
  shopId: number;
  credits: number;
}

/**
 * Чем оплачено конкретное автозаполнение.
 *
 * Размеченное объединение, а не «резерв либо null», как было до подписок.
 * Раньше бесплатная ветка была одна — администратор, — и её опознавали по
 * `hold === null`. Теперь бесплатных веток три, и они требуют разного отката:
 * `platform` откатывать нечего, `unlimited` тоже, `free` обязан вернуть
 * попытку в месячную норму, `paid` — снять резерв кредитов. Свести их к
 * `null` значило бы съедать у продавца бесплатную попытку каждый раз, когда
 * модель не ответила.
 */
export type AutofillHold =
  /** Администратор: за его запросы платит площадка. */
  | { kind: 'platform' }
  /** PRO и MAX: автозаполнение входит в абонплату без счётчика. */
  | { kind: 'unlimited'; shopId: number }
  /** START: занята одна из месячных бесплатных попыток. */
  | { kind: 'free'; shopId: number; month: string; leftAfter: number }
  /** Норма исчерпана или подписки нет — занят резерв кредитов по прайсу. */
  | { kind: 'paid'; hold: CreditHold };

/**
 * Ответ на «сколько будет стоить следующее нажатие».
 *
 * Считается тем же `autofillCharge`, что и сам резерв: подпись на кнопке и
 * фактическое списание обязаны совпадать, иначе получается худший из
 * возможных багов в деньгах — «бесплатно» над списанием десяти кредитов.
 *
 * Поля `price`, `allowed`, `balance` остались от прежнего ответа и означают
 * то же самое; остальные добавлены. `allowed` при этом сменил смысл целиком:
 * теперь при живой подписке START с непустой нормой он `true` даже при нулевом
 * балансе кредитов.
 */
export interface AutofillQuota {
  /** Цена автозаполнения в кредитах — сколько оно стоит без подписки. */
  price: number;
  /** Сколько спишут за следующее нажатие: ноль в бесплатных ветках. */
  effectivePrice: number;
  /** Следующее нажатие бесплатно — по норме либо по безлимиту. */
  free: boolean;
  /** Тариф даёт автозаполнение без счётчика (PRO, MAX). */
  unlimited: boolean;
  /** Остаток бесплатных попыток в этом месяце; `null` — счётчика нет. */
  freeLeft: number | null;
  /** Размер месячной нормы у тарифа, который её даёт. */
  freeLimit: number;
  /** Дата обновления нормы, `YYYY-MM-DD`; `null` — обновлять нечего. */
  resetsAt: string | null;
  /** Действующий тариф — из `effectiveLimits`, а не из колонки магазина. */
  plan: SubscriptionPlanId;
  /** Хватит ли на следующее нажатие. У администратора всегда `true`. */
  allowed: boolean;
  /** Доступный остаток кредитов; `null` — без ограничения (администратор). */
  balance: number | null;
}

/** Строка истории кредитов в том виде, в каком её можно показать продавцу. */
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

/**
 * Кредиты магазина на ИИ.
 *
 * Администратор работает без списания: у него нет магазина, а платит за его
 * запросы всё равно площадка. Для продавца порядок такой: занять резерв по
 * оценке → сделать запрос → списать фактическую стоимость из ответа
 * OpenRouter → освободить резерв.
 *
 * Карманов у магазина два: подписочные кредиты, сгорающие при выдаче следующей
 * нормы, и купленные, не сгорающие никогда. Наружу это почти не видно —
 * доступный остаток один и считается `available()`, — но порядок списания
 * задан и объяснён в `splitSpend`.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly repository: CreditsRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Магазин продавца — нужен и для баланса, и для списания. */
  shopIdOf(ownerId: number): Promise<number | undefined> {
    return this.repository.findShopIdByOwner(ownerId);
  }

  balance(shopId: number): Promise<ShopCredits | undefined> {
    return this.repository.find(shopId);
  }

  /**
   * Сколько магазин может потратить прямо сейчас — единственная точка, где
   * этот вопрос имеет ответ (B5).
   *
   * До подписок остаток считался как `balance − reserved`, и эта формула
   * успела разойтись по четырём файлам. С появлением второго кармана она стала
   * не просто неточной, а обидной: подписчик PRO с шестью тысячами
   * подписочных кредитов и нулём купленных получал `0` — то есть выключенный
   * диалог генерации фотографий и надпись «кредиты закончились» сразу после
   * оплаты тарифа. Считает теперь `AVAILABLE_CREDITS` в SQL, а все
   * пересчитывавшие сами обязаны звать этот метод.
   *
   * Магазина нет — ноль, а не исключение: спрашивают это ровно для того, чтобы
   * что-то показать, и «магазин не найден» тут ничем не лучше нуля.
   */
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

  /**
   * Та же история, но для продавца (V11).
   *
   * Отличается ровно одним — `meta` проходит через белый список
   * `sellerVisibleMeta`. В журнале лежат себестоимость запроса, оплаченная
   * сумма и множитель наценки: вместе они дают маржу площадки с точностью до
   * цента, и отдавать их тому, с кого эта маржа берётся, мы не собирались.
   * Отдельным методом, а не флагом в `history`, чтобы «забыть передать флаг»
   * было негде.
   */
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

  /**
   * Себестоимость запроса в кредиты, которые платит магазин. Наценка живёт
   * ровно здесь — и резерв, и списание проходят через неё, поэтому оценка и
   * факт всегда в одних единицах.
   */
  private async toCredits(usd: number): Promise<number> {
    const markup = await this.settings.getCreditMarkup();
    return usdToCredits(usd * markup);
  }

  /**
   * Занимает кредиты под запрос — на вход себестоимость в долларах, наценку
   * накидываем сами. `null` — списывать не с кого (администратор).
   *
   * Бросает, если у продавца нет активного магазина или не хватает остатка:
   * оба случая пользователь должен увидеть текстом, а не пустым результатом.
   */
  async hold(
    author: { id: number; isAdmin: boolean },
    estimateUsd: number,
    what: string,
  ): Promise<CreditHold | null> {
    if (author.isAdmin) return null;
    return this.reserve(author.id, await this.toCredits(estimateUsd), what);
  }

  /**
   * Занимает ровно назначенную цену — для операций с фиксированным прайсом.
   *
   * Наценка здесь не при чём: она пересчитывает себестоимость, а прайс уже
   * объявлен продавцу и от курса модели не зависит. Списывать такой резерв
   * нужно через `settleFixed`, иначе фактическая стоимость перебьёт цену.
   */
  async holdFixed(
    author: { id: number; isAdmin: boolean },
    credits: number,
    what: string,
  ): Promise<CreditHold | null> {
    if (author.isAdmin) return null;
    return this.reserve(author.id, credits, what);
  }

  /** Общая часть обоих резервов: найти магазин и занять у него сумму. */
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

  /**
   * Занять сумму у известного магазина.
   *
   * Отдельно от `reserve`, потому что автозаполнение к этому моменту магазин
   * уже нашло — вместе с тарифом, — и второй запрос к базе ради того же id был
   * бы не только лишним, но и опасным: между ними магазин может быть
   * упразднён, и резерв ушёл бы не туда, где считался лимит.
   */
  private async reserveOn(
    shopId: number,
    credits: number,
    what: string,
  ): Promise<CreditHold> {
    if (await this.repository.reserve(shopId, credits)) {
      return { shopId, credits };
    }

    /**
     * Не хватило — говорим, сколько есть. Остаток берётся `available()`, то
     * есть по обоим карманам: подписчик с непустой нормой и пустым купленным
     * счётом иначе прочитал бы «кредиты закончились» в день оплаты тарифа.
     */
    const available = await this.available(shopId);
    throw new ForbiddenException(
      available === 0
        ? 'Кредиты закончились. Обратитесь к администратору за пополнением.'
        : `Не хватает кредитов на ${what}: нужно ${credits}, доступно ${available}.`,
    );
  }

  /**
   * Списывает фактическую стоимость и снимает резерв. Возвращает списанное —
   * журнал использования ИИ пишет ту же цифру, что увидел магазин.
   *
   * `usd` берётся из ответа OpenRouter. Если его нет (документация обещает
   * стоимость «когда доступна»), списываем резерв целиком и помечаем запись —
   * иначе запрос оказался бы бесплатным для магазина и платным для площадки.
   */
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

  /**
   * Списывает назначенный прайс целиком, чем бы запрос ни обошёлся площадке.
   *
   * Фактическая стоимость идёт в журнал, но на сумму не влияет: цену кнопки
   * продавец увидел до нажатия, и пересчитывать её задним числом — обман
   * ожидания, даже когда пересчёт вышел бы в его пользу.
   *
   * Резерв и списание здесь всегда равны, поэтому отдельного возврата остатка
   * не бывает: либо списали прайс, либо (при сбое записи) сняли резерв целиком
   * и не взяли ничего.
   */
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

  /** Запрос не состоялся — возвращаем резерв, ничего не списывая. */
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

  /**
   * Резерв под автозаполнение карточки.
   *
   * Три ветки денег живут здесь, а не в `ProductAutofillService`: тому незачем
   * знать про тарифы, а порядок «бесплатно → платно» обязан быть один на все
   * точки входа — иначе вторая точка рано или поздно начнёт брать деньги за
   * то, за что первая не берёт.
   *
   * Порядок проверок: администратор → магазин есть? → безлимит тарифа →
   * месячная норма → кредиты. Тариф спрашивается у `effectiveLimits` (B4), а
   * не у `shop.subscriptionPlan`: в колонке после истечения намеренно остаётся
   * `'max'`, и прямое сравнение раздавало бы безлимит магазинам, переставшим
   * платить полгода назад.
   *
   * Норма не занята — падаем в платную ветку, а не отказываем: продавец, у
   * которого кончились пять бесплатных попыток, вправе доделать карточку за
   * кредиты, и узнать об этом он должен из цены кнопки, а не из отказа.
   */
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

  /**
   * Автозаполнение состоялось — рассчитаться.
   *
   * Возвращает списанные кредиты: ноль во всех бесплатных ветках. Ноль здесь
   * не значит «ничего не произошло» — себестоимость запроса всё равно обязана
   * уйти в `ai_usage` с отметкой `free`, иначе бесплатные автозаполнения
   * прочитаются в отчётах как чистый убыток площадки при нулевой выручке.
   * Отметку ставит вызывающий: он же и знает, какая была ветка.
   */
  async settleAutofill(
    hold: AutofillHold,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<number> {
    if (hold.kind !== 'paid') return 0;
    return this.settleFixed(hold.hold, usd, meta);
  }

  /**
   * Автозаполнение не состоялось — вернуть занятое.
   *
   * Бесплатная попытка возвращается так же, как кредиты: продавец нажал
   * кнопку, а модель не ответила — он не должен за это платить ни деньгами, ни
   * нормой. `platform` и `unlimited` возвращать нечего: ни счётчика, ни
   * резерва там не заводилось.
   */
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

  /**
   * Что написать на кнопке автозаполнения до нажатия.
   *
   * Считается тем же `autofillCharge` и тем же `effectiveLimits`, что и сам
   * резерв, и от того же счётчика с якорем (V8). Единственное, чего здесь нет
   * и быть не должно, — изменения состояния: `GET price` вызывается при каждом
   * открытии формы, и занимать бесплатную попытку показом её остатка было бы
   * замечательным способом обнулять норму, ничего не заполнив.
   *
   * Магазина нет — отдаём «платно и не хватает»: у покупателя без магазина
   * кнопки всё равно нет, а лезть тут в исключение значит уронить форму из-за
   * подписи под кнопкой.
   */
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
      /**
       * Всегда норма START, а не норма действующего тарифа. Это не остаток, а
       * ответ на вопрос «сколько бесплатных даёт подписка»: у безлимитных
       * тарифов и у магазина без подписки собственного числа тут нет, а
       * подставить ноль значило бы написать на странице тарифов «0 из 0» ровно
       * тем, кого мы зовём подписаться. Остаток живёт в `freeLeft`, и он `null`
       * везде, где счётчика нет.
       */
      freeLimit: AUTOFILL_FREE_PER_MONTH,
      resetsAt: hasCounter ? nextMonthStart(month) : null,
      plan: limits.id,
      allowed: charge !== 'paid' || available >= AUTOFILL_CREDITS,
      balance: available,
    };
  }

  /**
   * Выдача кредитов. Начисляем ровно оплаченное: $20 дают 20 000 кредитов,
   * чтобы баланс совпадал с деньгами, которые магазин отдал. Маржа площадки
   * берётся не здесь, а при списании — через тот же множитель.
   */
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

  /**
   * Выдать норму подписочных кредитов и продлить период — обёртка над
   * репозиторием для `SubscriptionsService`.
   *
   * Транзакция приходит снаружи и это принципиально: запись платежа, смена
   * тарифа и выдача кредитов обязаны лечь одним коммитом. Разбор правил Д1
   * (когда норма прибавляется, а когда присваивается) — в докблоке
   * `CreditsRepository.grantSubscription`; на вход идёт число месяцев, а не
   * готовая дата окончания, потому что считать её можно только под уже взятой
   * блокировкой строки.
   */
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

  /**
   * Есть ли у магазина оплаченная подписка (V6) — спрашивает `ShopsService`
   * перед удалением магазина. Почему проверка живёт в кредитах, объяснено в
   * `CreditsRepository.hasPaidSubscription`.
   */
  hasPaidSubscription(shopId: number): Promise<boolean> {
    return this.repository.hasPaidSubscription(shopId);
  }

  /**
   * Приветственные кредиты новому магазину — акция «попробуй генерацию
   * бесплатно». Выдаются один раз: повторную выдачу ловим по метке в журнале,
   * иначе удалённый и заново созданный магазин получал бы подарок снова.
   *
   * Автор выдачи пустой: начисляет система. Возвращает начисленное — 0 значит
   * «уже получал», и вызывающему не о чем сообщать.
   */
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

  /**
   * Отобрать кредиты — ошибочная выдача, возврат оплаты, санкция.
   *
   * Отдельным видом операции (`adjust`), а не выдачей с минусом: в истории
   * магазина должно быть видно, что баланс уменьшил человек, а не запрос к
   * модели.
   */
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

  /** Сколько кредитов даст сумма — для предпросмотра в форме выдачи. */
  async preview(paidUsd: number): Promise<{ credits: number; markup: number }> {
    const markup = await this.settings.getCreditMarkup();
    return { credits: usdToCredits(paidUsd), markup };
  }
}
