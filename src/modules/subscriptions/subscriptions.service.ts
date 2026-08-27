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
  TZ,
  buildPlans,
  effectiveLimits,
  isPaidPlan,
  monthStart,
  type PaidPlan,
  type PlanSpec,
} from './subscriptions.constants';
import type { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import type { FindAdminSubscriptionsQueryDto } from './dto/find-admin-subscriptions-query.dto';
import type {
  AdminSubscriptionRowDto,
  PaymentLinkDto,
  SellerSubscriptionDto,
  SubscriptionPaymentDto,
  SubscriptionPlanDto,
} from './dto/subscription.dto';

/**
 * Чем кончился Prepare. Размеченное объединение, а не исключения: контроллер
 * колбэка обязан ответить провайдеру кодом протокола, а не HTTP-ошибкой, и
 * каждый вид отказа имеет свой код. Исключение здесь означало бы 500 в ответ
 * Click — то есть повтор запроса вместо разбора причины.
 */
export type PrepareResult =
  | { kind: 'prepared'; payment: SubscriptionPayment }
  | { kind: 'already_paid' }
  | { kind: 'cancelled' }
  | { kind: 'conflict' };

/**
 * Чем кончился Complete.
 *
 * `mismatch` и `shop_gone` добавлены к списку из проекта намеренно (B2, V3).
 * Оба означают «деньги списаны, а выдать нечего», но по разным причинам:
 * первое — реквизиты не сошлись с сохранённым Prepare, второе — магазина к
 * моменту подтверждения не стало. Свести их к `not_found` нельзя: `not_found`
 * отвечает провайдеру «такой транзакции не существует», а транзакция как раз
 * существует, и вести себя дальше нужно по-разному — на `not_found` возврат
 * денег и разбор, на `mismatch` тоже возврат, но с другим кодом ответа.
 */
export type CompleteResult =
  | {
      kind: 'paid';
      payment: SubscriptionPayment;
      ownerId: number;
      shopName: string;
    }
  | { kind: 'already_paid' }
  | { kind: 'cancelled' }
  | { kind: 'not_found' }
  | { kind: 'mismatch' }
  | { kind: 'invalid_amount' }
  | { kind: 'shop_gone' };

/**
 * Совпадают ли суммы с точностью до копейки.
 *
 * Через целые копейки, а не `===` над числами с плавающей точкой: Click
 * присылает сумму текстом с двумя знаками, из базы она приходит числом (колонка
 * объявлена `numeric(..., mode: 'number')`), и `65000.00 === 65000` истинно
 * только потому, что оба представимы точно. На суммах вроде `130000.10`
 * равенство уже зависело бы от порядка арифметики.
 *
 * `Math.round`, а не `toFixed`: последний возвращает строку и на строке из базы
 * (что и было бы без `mode: 'number'`) упал бы вовсе — ровно тот блокер, из-за
 * которого каждый успешный платёж получал бы `invalid_amount (-2)` после
 * списания денег.
 */
function sameAmount(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

/** Дата для человека — в поясе площадки, а не в UTC контейнера. */
function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

/**
 * Подписка магазина: прайс, приём оплаты, выдача периода и его отмена.
 *
 * Денежный путь целиком. Два правила, которым здесь подчинено всё остальное:
 *
 * 1. **Деньги и состояние подписки меняются одним коммитом.** Строка платежа,
 *    колонки `shops.subscription_*` и обе записи в журнале кредитов пишутся в
 *    одной транзакции. Подписка, выданная без записи о платеже, неотличима от
 *    подарка; платёж без подписки — от кражи.
 * 2. **Действующий тариф спрашивается только у `effectiveLimits` (B4).**
 *    `shops.subscription_plan` после истечения намеренно сохраняет купленный
 *    когда-то `max`, и прямое сравнение с ним раздавало бы права магазинам,
 *    переставшим платить полгода назад.
 *
 * Сеть наружу здесь ровно одна — сборка ссылки на кассу, и та без запроса.
 * Возврат денег живёт в `ClickMerchantService`, отправка уведомлений — в
 * `NotificationsService`: сервис подписок можно проверить, не подняв ни одного
 * сокета.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  /** Прайс, собранный один раз на старте. Дальше только читается. */
  private specs: PlanSpec[] = [];
  private specById = new Map<PaidPlan, PlanSpec>();

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly credits: CreditsService,
    private readonly merchant: ClickMerchantService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Собрать прайс и проверить его пригодность к работе.
   *
   * Проверка обязана быть на старте, а не при первой оплате. Click в колбэке
   * не сообщает, за что заплатили: приходит только сумма, и тариф определяется
   * сопоставлением с прайсом. Две одинаковые цены означают, что купивший MAX
   * получит PRO, а ноль или `NaN` — что не купит никто; узнали бы мы об этом
   * из жалобы. Упавший при запуске контейнер чинится за минуту, молча сломанный
   * прайс — неделями.
   *
   * Сами проверки живут в `buildPlans` рядом с таблицей тарифов; здесь только
   * запись в журнал перед падением: без неё в логе останется голый стектрейс
   * фабрики Nest, по которому неочевидно, что чинить надо переменные окружения.
   */
  onModuleInit(): void {
    const prices: Record<PaidPlan, number> = {
      start: this.config.get<number>('subscription.priceStartUzs') ?? 0,
      pro: this.config.get<number>('subscription.priceProUzs') ?? 0,
      max: this.config.get<number>('subscription.priceMaxUzs') ?? 0,
    };

    try {
      this.specs = buildPlans(prices);
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

  /* ------------------------------------------------------------------ */
  /* Прайс                                                               */
  /* ------------------------------------------------------------------ */

  /** Публичная витрина тарифов. */
  plans(): SubscriptionPlanDto[] {
    return this.specs.map((spec) => ({
      id: spec.id,
      priceUzs: spec.priceUzs,
      months: spec.months,
      credits: spec.credits,
      freeAutofills: spec.freeAutofills,
      /**
       * Наружу отдаётся «поднимает ли тариф в выдаче», а не сам вес: число
       * веса — устройство сортировки витрины, и обещать по нему «в два раза
       * выше» мы не можем и не хотим.
       */
      promoted: spec.promoWeight > 1,
      bannerSlots: spec.bannerSlots,
      analyticsDays: spec.analyticsDays,
    }));
  }

  /**
   * Тариф по сумме платежа — единственный способ узнать, что купили.
   *
   * Click передаёт только сумму. Сверка идёт по копейкам (`sameAmount`), а не
   * по строгому равенству: касса присылает `65000.00`, в конфигурации лежит
   * `65000`, и на числах с плавающей точкой это одно и то же лишь до первой
   * цены с копейками.
   */
  planByAmount(amount: number): PaidPlan | null {
    const spec = this.specs.find((item) => sameAmount(item.priceUzs, amount));
    return spec ? spec.id : null;
  }

  private specOf(plan: PaidPlan): PlanSpec {
    const spec = this.specById.get(plan);
    if (!spec) throw new BadRequestException('Неизвестный тариф');
    return spec;
  }

  /* ------------------------------------------------------------------ */
  /* Касса                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Настроен ли приём оплаты — проверка перед выдачей ссылки на кассу.
   *
   * В production дополнительно требуется настроенный возврат. Это не
   * перестраховка: если выдать подписку не удастся (магазин упразднили между
   * Prepare и Complete, база не ответила), единственный способ не оставить
   * человека без денег и без подписки — вернуть платёж через Merchant API.
   * Брать деньги, не имея возможности их вернуть, нельзя. Вне production
   * ограничение снято намеренно — на стенде касса проверяется символическими
   * суммами, и требовать там реквизиты Merchant API значило бы заставить
   * разработчика держать боевые ключи.
   */
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

  /**
   * Ссылка на кассу.
   *
   * `transaction_param` — telegram-id владельца, а не `shops.id` (V4).
   * `shops.id` — `bigserial` с единицы, и при оплате из приложения Click, где
   * номер человек вводит руками, опечатка в двузначном числе с высокой
   * вероятностью попадёт в существующий магазин: деньги спишутся, а подписку
   * получит кто-то посторонний. Telegram-id — девять-десять знаков, и
   * случайная опечатка в нём почти наверняка не соответствует ни одному
   * пользователю, то есть отобьётся на Prepare, где деньги ещё не тронуты.
   */
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
        returnUrl: this.config.get<string>('click.returnUrl'),
      }),
    };
  }

  /**
   * Разрешить `merchant_trans_id` в магазин (V4).
   *
   * Одна ветка и только telegram-id. Запасной поиск по `shops.id` для чисел,
   * которые под telegram-id не подходят, выглядит удобным, но означает два
   * способа истолковать одно число — и однажды они истолкуют его по-разному.
   *
   * Формат проверяется до похода в базу: `merchant_trans_id` приходит снаружи,
   * а `Number('1e9')` или `Number(' 12 ')` дали бы правдоподобное число из
   * строки, которая telegram-id не является.
   */
  async findShopForPayment(
    merchantTransId: string,
  ): Promise<PaymentShop | undefined> {
    const trimmed = merchantTransId.trim();
    if (!/^\d{5,18}$/.test(trimmed)) return undefined;

    const telegramId = Number(trimmed);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return undefined;

    return this.repository.findShopByOwnerTelegramId(telegramId);
  }

  /* ------------------------------------------------------------------ */
  /* Двухфазный протокол                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Сохранить Prepare прежде, чем ответить провайдеру «счёт принят».
   *
   * `INSERT … ON CONFLICT DO NOTHING` плюс повторное чтение `FOR UPDATE`, а не
   * проверка «есть ли такой click_trans_id» перед вставкой: между проверкой и
   * вставкой помещается второй такой же колбэк, и разрешить эту гонку может
   * только сама база. Вернувшаяся строка — либо наша, либо чужая попытка того
   * же платежа, и во втором случае мы отвечаем тем же номером счёта, что и в
   * первый раз.
   *
   * Пустой результат обоих запросов означает не «не нашли», а «конфликт был по
   * другому индексу» (V1): один и тот же `click_paydoc_id` пришёл под новым
   * номером транзакции. Это единственный случай, когда метод бросает, и бросить
   * он обязан — иначе одно списание оплатило бы два периода.
   */
  async prepare(input: {
    shopId: number;
    plan: PaidPlan;
    amount: number;
    providerTransactionId: string;
    providerPaymentId: string;
    serviceId: string;
    signTime: string;
  }): Promise<PrepareResult> {
    return this.repository.transaction<PrepareResult>(async (tx) => {
      let payment = await this.repository.insertPrepared(tx, {
        shopId: input.shopId,
        plan: input.plan,
        amount: input.amount,
        providerTransactionId: input.providerTransactionId,
        providerPaymentId: input.providerPaymentId,
        meta: { serviceId: input.serviceId, signTime: input.signTime },
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

        /**
         * Реквизиты повторного Prepare обязаны совпасть с сохранёнными. Иначе
         * это не повтор, а другой платёж под тем же номером транзакции: либо
         * ошибка на стороне провайдера, либо попытка оплатить чужой магазин
         * дешёвым тарифом. Отказ здесь ничего не стоит — деньги ещё не тронуты.
         */
        if (
          payment.shopId !== input.shopId ||
          payment.plan !== input.plan ||
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

      /**
       * Номер счёта выдаёт база (`merchant_billing_id`), поэтому до вставки его
       * не существует. Складываем его же в `provider_prepare_id`: по этой
       * колонке потом сверяется Complete, и хранить рядом то, что мы
       * действительно ответили провайдеру, дешевле, чем каждый раз выводить это
       * заново.
       */
      const prepareId = String(payment.merchantBillingId);
      if (payment.providerPrepareId !== prepareId) {
        payment = await this.repository.setPrepareId(tx, payment.id, prepareId);
      }

      return { kind: 'prepared', payment };
    });
  }

  /**
   * Подтвердить или отменить ранее сохранённый Prepare.
   *
   * Поиск строго по `click_trans_id` (B2) — это единственный документированный
   * ключ идемпотентности. Искать сразу по трём реквизитам заманчиво, но тогда
   * расхождение любого из них означало бы ответ «транзакции не существует»
   * (`-6`) при уже списанной карте, и следа об этом не осталось бы нигде.
   * Реквизиты проверяются отдельными ветками над найденной строкой, и каждая
   * отвечает своим кодом.
   *
   * Порядок веток внутри транзакции важен и выбран так:
   * реквизиты → сумма → **отмена провайдером** → статус → магазин → выдача.
   * Ветка `clickError < 0` стоит до проверок статуса (V2): Complete с
   * отрицательным кодом по уже оплаченной транзакции — это уведомление о
   * возврате, и ответить на него `already_paid` значило бы не заметить, что
   * деньги ушли обратно. А вот до проверки реквизитов её поднимать нельзя:
   * отменять платёж по запросу, реквизиты которого не сошлись с нашими,
   * означало бы отдать управление чужой стороне.
   *
   * Обе строки — платёж и магазин — блокируются `FOR UPDATE`. Без блокировки
   * магазина два платежа, пришедшие одновременно (продавец нажал «оплатить» в
   * двух вкладках), прочитали бы один и тот же `subscription_until`, и второй
   * затёр бы период первого: оплаченный месяц просто исчез бы.
   */
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

        /**
         * Номер счёта, который мы вернули провайдеру на Prepare. Источник
         * правды — `merchant_billing_id`: `provider_prepare_id` лишь его копия,
         * и на строке, пережившей сбой между вставкой и проставлением копии,
         * он окажется пустым. Сверять при этом нужно именно с тем, что было
         * отправлено, а не с тем, что успело записаться.
         */
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

          /**
           * Д3. Провайдер вернул уже оплаченный платёж. Период автоматически
           * НЕ отзывается: за прошедшее время магазин мог потратить выданные
           * кредиты, поднялся в выдаче и, возможно, показал баннер, — отобрать
           * это одной строкой в колбэке нельзя, а «отнять сколько получится»
           * хуже, чем не отнимать ничего. Строка помечается как требующая
           * разбора, и решение принимает человек: отменить подписку кнопкой в
           * админке либо оставить и разбираться с провайдером.
           */
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

        /**
         * V3. Статус магазина перепроверяется уже под взятой блокировкой.
         * Между разрешением `merchant_trans_id` в начале колбэка и этим
         * моментом помещается упразднение магазина администратором, а выдавать
         * подписку витрине, которой больше нет, нельзя. Ответ уходит в ветку
         * возврата денег: на Complete они уже списаны.
         */
        const shop = await this.repository.lockShop(tx, payment.shopId);
        if (!shop || shop.status !== 'active') {
          this.logger.error(
            `Click Complete по магазину ${payment.shopId}, которого нет или он упразднён ` +
              `(click_trans_id=${input.providerTransactionId})`,
          );
          return { kind: 'shop_gone' };
        }

        /**
         * Тариф читается со строки платежа, а не пересчитывается по сумме
         * заново: покупка состоялась на Prepare, и если прайс успели поменять
         * между стадиями, человек обязан получить то, за что платил.
         */
        if (!isPaidPlan(payment.plan)) {
          this.logger.error(
            `Платёж ${payment.id} записан с непокупаемым тарифом «${payment.plan}» — выдавать нечего`,
          );
          return { kind: 'mismatch' };
        }
        const spec = this.specOf(payment.plan);

        /**
         * Выдача кредитов и продление периода — в этой же транзакции. Здесь же
         * считается и сам период: начало берётся как максимум из «сейчас» и
         * конца прежнего срока (Д1, оплата заранее не съедает оплаченные дни),
         * а норма кредитов при живой подписке прибавляется и присваивается со
         * сжиганием остатка при истёкшей. Считать это до `FOR UPDATE` нельзя —
         * правильного ответа там ещё не существует.
         */
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
      this.logger.log(
        `Подписка ${result.payment.plan.toUpperCase()} оплачена: магазин ${result.payment.shopId}, ` +
          `платёж ${result.payment.id}, до ${result.payment.activatedUntil?.toISOString() ?? '—'}`,
      );
      this.announceGranted(result.ownerId, result.payment);
    }

    return result;
  }

  /**
   * Записать провалившийся Complete (B3).
   *
   * Зовётся из общей ветки контроллера, когда Complete отказал при уже
   * списанных деньгах: `not_found`, `invalid_amount`, `mismatch`, `shop_gone`
   * и любое исключение. К этому моменту деньги либо возвращены через Merchant
   * API, либо вернуть их не удалось, — и то и другое обязано остаться в
   * журнале, иначе разбирать обращение «списали и ничего не дали» будет нечем.
   *
   * Метод обязан переживать отсутствие строки платежа: до Complete дело могло
   * дойти без Prepare вовсе (перезапуск разбора на стороне провайдера,
   * потерянный первый колбэк). Тогда строка заводится здесь.
   *
   * Метод не бросает никогда: его вызывают из `catch` обработчика колбэка, и
   * исключение оттуда ушло бы к Click пятисоткой вместо кода протокола.
   */
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
    /**
     * «Требует разбора» ставится только при неудавшемся возврате. Удавшийся
     * возврат — это уже разобранный случай: деньги у человека, подписки нет,
     * ничьё вмешательство не нужно. Пометить такие строки тоже значило бы
     * завалить вкладку разбора событиями, с которыми делать нечего, — и
     * потерять среди них те несколько, где деньги действительно застряли.
     */
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
          /**
           * Оплаченную строку не переводим в «отменена» ни при каких условиях.
           * Сюда можно попасть уже после успешной выдачи — например, если
           * исключение случилось после коммита, — и статус `cancelled` над
           * выданной подпиской означал бы, что журнал платежей противоречит
           * колонкам магазина. Пишем только мету и зовём человека.
           */
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

        /**
         * Магазин не разрешился — писать строку некуда: `shop_id` в журнале
         * платежей `NOT NULL` и ссылается на магазин. Отвязывать её от
         * магазина ради этого случая нельзя: тогда журнал перестал бы быть
         * журналом магазина, а найти такой платёж всё равно можно только по
         * номеру транзакции, который уже есть в логе.
         */
        if (input.shopId === null) {
          this.logger.error(
            `Отказ Complete без разрешённого магазина: click_trans_id=${input.providerTransactionId}, ` +
              `click_paydoc_id=${input.providerPaymentId}, сумма ${input.amount}, возврат ${input.reversed ? 'выполнен' : 'НЕ выполнен'}`,
          );
          return;
        }

        /**
         * Сумму разобрать не удалось — новой строки не заводим.
         *
         * На `amount` в журнале стоит check `> 0`, и вставка нуля откатила бы
         * транзакцию: наружу ушла бы ошибка Postgres вместо адресного лога, а
         * сам случай — потерянные деньги — оказался бы описан хуже, чем без
         * записи вовсе. Проверкой, а не исключением, ровно поэтому: исход
         * известен заранее и объясним.
         *
         * Терять при этом нечего: `click_trans_id` и `click_paydoc_id` уже
         * записаны в лог веткой `failComplete`, а деньги к этому моменту либо
         * возвращены, либо помечены к возврату руками.
         */
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
          /**
           * Тариф выводим по сумме, а не по строке платежа — её нет. `free`
           * означает здесь «сумма не совпала ни с одним тарифом», то есть
           * куплено не было ничего: это честнее, чем записать ближайший
           * похожий тариф в журнал несостоявшейся покупки.
           */
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

  /* ------------------------------------------------------------------ */
  /* Кабинет продавца                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Магазин продавца.
   *
   * Через собственный запрос, а не через `ShopsService.getActiveOwnShopOrThrow`
   * (V13), по двум причинам, и обе существенные. Первая: подписке нужен
   * telegram-id владельца — он уходит в кассу как `merchant_trans_id`, — а тот
   * метод отдаёт только магазин. Вторая: он отвечает `404 Магазин не найден`, а
   * здесь нужен именно `403` с текстом про владельца активного магазина —
   * продавец, чей магазин упразднён, спрашивает не «где мой магазин», а
   * «почему мне не продают подписку». Фильтр `status = 'active'` дословно тот
   * же, и разъехаться им нельзя.
   */
  private async shopOfOwner(ownerId: number): Promise<PaymentShop> {
    const shop = await this.repository.findShopByOwner(ownerId);
    if (!shop) {
      throw new ForbiddenException(
        'Подписка доступна только владельцу активного магазина',
      );
    }
    return shop;
  }

  /** Состояние подписки магазина продавца. */
  async stateForOwner(ownerId: number): Promise<SellerSubscriptionDto> {
    const shop = await this.shopOfOwner(ownerId);
    return this.stateOf(shop.id);
  }

  /** Журнал платежей магазина продавца. */
  async paymentsForOwner(ownerId: number, query: PaginationQueryDto) {
    const shop = await this.shopOfOwner(ownerId);
    return this.payments(shop.id, query);
  }

  /**
   * Что показать на странице подписки.
   *
   * Тариф — исключительно через `effectiveLimits` (B4): просроченный `max` в
   * колонке магазина обязан выглядеть здесь как `free`, иначе продавец увидит
   * тариф, которого у него нет, и не поймёт, почему заблокированы баннер и
   * аналитика.
   *
   * Все числа приходят из SQL уже приведёнными к `int` (V5): выражения над
   * `bigint` node-postgres отдаёт строкой, и `available` вида `"2900"` дальше
   * либо складывался бы склейкой, либо сравнивался бы с числом как `false`.
   */
  async stateOf(shopId: number): Promise<SellerSubscriptionDto> {
    const month = monthStart();
    const row = await this.repository.stateOf(shopId, month);
    if (!row) throw new NotFoundException('Магазин не найден');

    const now = new Date();
    const limits = effectiveLimits(row, now);
    const active = limits.id !== 'free';
    const until = row.subscriptionUntil;

    /**
     * Счётчик есть только у тарифа с конечной нормой. У безлимитных и у
     * магазина без подписки остатка не существует — `null`, а не ноль: ноль
     * читается как «попытки кончились», что для владельца PRO прямо неверно.
     */
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
        /**
         * Всегда норма START, а не норма действующего тарифа: это не остаток,
         * а ответ на вопрос «сколько бесплатных даёт подписка». У безлимитных
         * тарифов и у магазина без подписки собственного числа тут нет, а ноль
         * на странице тарифов увидели бы ровно те, кого мы зовём подписаться.
         */
        limit: AUTOFILL_FREE_PER_MONTH,
        resetsAt: nextMonthStart(month),
      },
      bannerSlots: limits.bannerSlots,
      analyticsDays: limits.analyticsDays,
      promoted: limits.promoWeight > 1,
    };
  }

  /** Журнал платежей магазина. */
  async payments(shopId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.paymentsOf(
      shopId,
      query,
    );
    return buildPaginatedResult(data.map(toPaymentDto), total, page, limit);
  }

  /* ------------------------------------------------------------------ */
  /* Админка                                                             */
  /* ------------------------------------------------------------------ */

  /** Список подписок с флагами разбора. */
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

  /**
   * Ручная активация подписки администратором (Д2).
   *
   * Начисление `кредиты × месяцы` одной строкой не противоречит правилу
   * «норма обнуляется при каждой оплате»: правило про то, что остаток прошлого
   * периода не копится бесконечно, а здесь один период длиной в несколько
   * месяцев, а не несколько периодов подряд. Выдать три месяца тремя вызовами
   * было бы формально ближе к букве, но дало бы три строки в журнале за одно
   * решение человека и три пересчёта срока — то есть тот же результат более
   * запутанным путём.
   *
   * Идемпотентность — по времени: у ручной активации нет идентификатора, по
   * которому отличают повтор от нового намерения, а двойное нажатие в админке
   * стоило бы магазину лишнего месяца и лишней нормы кредитов. Минута заведомо
   * больше задержки ответа и заведомо меньше времени, за которое человек
   * осознанно решит продлить магазин ещё раз.
   */
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
        /**
         * Денег по этой строке не двигалось, но колонка объявлена `NOT NULL` с
         * проверкой «больше нуля» — она защищает журнал от чужих колбэков с
         * пустой суммой. Пишем прайс, умноженный на срок: это единственное
         * осмысленное число, а отличить ручную выдачу от настоящей оплаты
         * позволяет `provider = 'manual'`, по которому и отсекаются такие
         * строки в любом денежном отчёте.
         */
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

  /**
   * Отменить подписку досрочно.
   *
   * `subscription_until = now()` — то же самое, что естественное истечение, и
   * второй ветки поведения не появляется: подписочные кредиты не сгорают, а
   * запираются предикатом и вернутся при новой оплате.
   *
   * Компенсирующая строка в журнале обязательна: без неё журнал утверждал бы,
   * что подписка действует до конца оплаченного месяца, тогда как в магазине
   * она уже оборвана, и разбирать обращение «почему пропал тариф, я же платил»
   * было бы нечем — оплата видна, отмена нет.
   *
   * Оговорка для всех, кто будет читать журнал. Инвариант из схемы —
   * «`shops.subscription_until` равен максимальному `activated_until` среди
   * строк `paid`» — этой строкой **не восстанавливается**: у оборванного
   * платежа `activated_until` остаётся в будущем, и максимум по-прежнему
   * больше нового срока. Подправлять его мы не будем — он записывает, что
   * человек оплатил, а не что ему в итоге досталось, и переписывать оплату
   * задним числом при разборе спора о деньгах нельзя. Отсюда правило:
   * действующий срок берётся из `shops.subscription_until` (так и делает
   * выборка напоминаний), а по журналу восстанавливается **последней** строкой
   * `paid`, а не максимумом.
   */
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
        /**
         * Единица, а не цена тарифа: по этой строке не заплачено ничего, а
         * `subscription_payments_amount_positive` не разрешает ноль. Из двух
         * неправд — «стоила столько же, сколько тариф» и «стоила один сум» —
         * вторая безобиднее: её невозможно принять за настоящую оплату.
         */
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

  /* ------------------------------------------------------------------ */
  /* Побочные эффекты                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Сбросить кэш витрины и сообщить владельцу об оплаченной подписке.
   *
   * **Ничего из этого не имеет права повлиять на результат.** Метод не
   * возвращает промис и глотает все ошибки: он вызывается после коммита
   * успешного Complete, и упавший Telegram или недоступный Redis не должны
   * превращать оплаченную подписку в ошибку — а тем более запускать возврат
   * денег по платежу, который прошёл целиком.
   *
   * Кэш каталога сбрасывается потому, что продвижение обязано стать видно
   * сразу: продавец, купивший PRO, пойдёт проверять выдачу через минуту, а
   * ключи списков живут дольше.
   */
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

  /** То же самое для ручных действий администратора. */
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
        /** Разметку Telegram в push отдавать нельзя — там она просто текст. */
        body: text.replaceAll(/<\/?b>/g, ''),
        url: '/seller/subscription',
        tag: `subscription-${shopId}`,
      }),
      `push владельцу ${ownerId} об изменении подписки`,
    );
  }

  /**
   * Отпустить побочный эффект, оставив от него только строчку в журнале.
   *
   * `void` перед промисом — не косметика: без него отказ уйдёт в
   * `unhandledRejection`, а с `await` вызывающий начал бы ждать сеть в
   * обработчике колбэка, у которого есть считаные секунды до повтора запроса
   * от провайдера.
   */
  private fireAndForget(promise: Promise<unknown>, what: string): void {
    void promise.catch((error: unknown) =>
      this.logger.error(
        `Не удалось выполнить ${what}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

/**
 * Строка журнала в том виде, в каком её можно показать.
 *
 * `meta` целиком наружу не уходит: там лежат `service_id`, `sign_time` и
 * идентификатор администратора — ничего из этого в разборе «за что списали» не
 * помогает, а первые два ещё и описывают наши настройки у провайдера.
 * Вытаскиваем ровно то, что объясняет судьбу денег.
 */
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
