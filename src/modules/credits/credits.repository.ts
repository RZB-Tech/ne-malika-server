import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb, type Tx } from '../../db/db.provider';
import {
  type CreditTxnMeta,
  creditTransactions,
  shops,
  subscriptionPayments,
} from '../../db/schema';
import {
  AVAILABLE_CREDITS,
  SUBSCRIPTION_ACTIVE,
  USABLE_SUBSCRIPTION_CREDITS,
} from '../../db/subscriptions';
import {
  addMonths,
  SUBSCRIPTION_BURN_NOTE,
  SUBSCRIPTION_GRANT_NOTE,
  type PaidPlan,
  type SubscriptionPlanId,
} from '../subscriptions/subscriptions.constants';
import { splitSpend } from './credits.constants';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';

/**
 * Состояние обоих счетов магазина.
 *
 * `balance` и `reserved` остались прежними — на них смотрит уже написанный
 * код. Три новых поля добавлены, а не подменили старые: `balance` во всех
 * существующих местах означает «купленные кредиты», и поменять его смысл
 * значило бы тихо сломать админку и историю выдач ради удобства одного экрана.
 */
export interface ShopCredits {
  /** Купленные и подаренные кредиты. Не сгорают никогда. */
  balance: number;
  /** Занято выполняющимися сейчас запросами — из обоих карманов сразу. */
  reserved: number;
  /** Кредиты подписки как они лежат в колонке, независимо от срока. */
  subscription: number;
  /** Из них доступны к трате: у истёкшей подписки это ноль. */
  usable: number;
  /** Сколько магазин может потратить прямо сейчас: `balance + usable − reserved`. */
  available: number;
}

/** Состояние подписки магазина — то, что нужно гейтам через `effectiveLimits`. */
export interface ShopSubscriptionState {
  id: number;
  subscriptionPlan: SubscriptionPlanId;
  subscriptionUntil: Date | null;
}

/** То же плюс счётчики автозаполнения — одним запросом для `GET price`. */
export interface ShopAutofillState extends ShopSubscriptionState {
  /**
   * Бесплатных попыток израсходовано в текущем месяце. Считается с якорем
   * (V8): счётчик обнуляется лениво, внутри `claimFreeAutofill`, и первого
   * числа в колонке ещё лежит прошлое число.
   */
  freeUsed: number;
  /** Доступный остаток кредитов — для платной ветки и для кнопки. */
  available: number;
}

/** Что выдача подписочной нормы сделала с деньгами и сроком магазина. */
export interface SubscriptionGrantResult {
  /** Сколько подписочных кредитов сгорело в этот момент. */
  burned: number;
  /** Сколько выдано по норме тарифа. */
  granted: number;
  /** Начало оплаченного периода: `now()` либо конец прежнего, если он ещё не прошёл. */
  from: Date;
  /** Конец оплаченного периода — он же новый `shops.subscription_until`. */
  until: Date;
}

@Injectable()
export class CreditsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Баланс магазина: два счёта и то, что реально доступно к трате.
   *
   * `::int` на обоих вычисляемых полях обязателен (V5). `credits_balance`,
   * `subscription_credits` и `credits_reserved` — `bigint`, а выражение над
   * ними node-postgres отдаёт строкой: парсеров типов в `db.provider.ts` нет,
   * и без каста `available` приехал бы как `"2900"`. Дальше это сравнивается с
   * числом (`available > 0`, `available >= price`) и складывается — то есть
   * молча даёт то `false` на непустом остатке, то склейку строк вместо суммы.
   *
   * Переполнение int4 здесь невозможно: кредит равен десятой доле цента, и два
   * миллиарда кредитов — это два миллиона долларов на одном магазине.
   */
  async find(shopId: number): Promise<ShopCredits | undefined> {
    const rows = await this.db
      .select({
        balance: shops.creditsBalance,
        reserved: shops.creditsReserved,
        subscription: shops.subscriptionCredits,
        usable: sql<number>`${USABLE_SUBSCRIPTION_CREDITS}::int`,
        available: sql<number>`${AVAILABLE_CREDITS}::int`,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return rows[0];
  }

  /** Магазин продавца. Кредиты живут у магазина, а запрос делает его владелец. */
  async findShopIdByOwner(ownerId: number): Promise<number | undefined> {
    const rows = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0]?.id;
  }

  /**
   * Магазин продавца вместе с состоянием подписки.
   *
   * Отдельным методом, а не расширением `findShopIdByOwner`: тот вызывается
   * там, где нужен только идентификатор, и таскать за собой тариф ему незачем.
   * Здесь же гейт автозаполнения обязан получить обе колонки разом — иначе
   * между «узнали магазин» и «узнали тариф» помещается ровно тот запрос,
   * который подписку и продлил.
   *
   * Колонки отдаются сырыми, без вывода «жив тариф или нет»: это решает
   * `effectiveLimits` (B4), и второй его копии в репозитории быть не должно.
   */
  async findShopSubscriptionByOwner(
    ownerId: number,
  ): Promise<ShopSubscriptionState | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
      })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  /**
   * Всё, что нужно ответу `GET /product-autofill/price`, одним запросом.
   *
   * Счётчик бесплатных попыток берётся тем же выражением с якорем, каким его
   * увеличивает `claimFreeAutofill` (V8). Читать колонку напрямую нельзя:
   * сброс ленивый, и первого числа месяца там ещё лежит прошлое число — кнопка
   * объявила бы «10 кредитов» за нажатие, которое на самом деле бесплатно, и
   * продавец просто не стал бы его делать.
   */
  async findAutofillStateByOwner(
    ownerId: number,
    month: string,
  ): Promise<ShopAutofillState | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
        freeUsed: sql<number>`(case when ${shops.autofillPeriodMonth} = ${month}::date then ${shops.autofillFreeUsed} else 0 end)::int`,
        available: sql<number>`${AVAILABLE_CREDITS}::int`,
      })
      .from(shops)
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  /**
   * Занимает кредиты под запрос одним UPDATE.
   *
   * Условие проверяется тем же оператором, который меняет счётчик: два
   * параллельных запроса не могут оба увидеть свободный остаток — Postgres
   * сериализует их на блокировке строки. Возвращает false, если не хватает.
   *
   * Доступное считается по обоим карманам (`AVAILABLE_CREDITS`, B5). Резерв
   * при этом остаётся один и общий: он про «занято выполняющимся запросом», а
   * из какого кармана в итоге спишется, на момент резерва ещё неизвестно —
   * подписка может истечь между началом генерации и её оплатой.
   */
  async reserve(shopId: number, credits: number): Promise<boolean> {
    const rows = await this.db
      .update(shops)
      .set({ creditsReserved: sql`${shops.creditsReserved} + ${credits}` })
      .where(and(eq(shops.id, shopId), sql`${AVAILABLE_CREDITS} >= ${credits}`))
      .returning({ id: shops.id });
    return rows.length > 0;
  }

  /** Снимает резерв, не трогая баланс. */
  async release(shopId: number, credits: number): Promise<void> {
    await this.db
      .update(shops)
      .set({
        creditsReserved: sql`greatest(0, ${shops.creditsReserved} - ${credits})`,
      })
      .where(eq(shops.id, shopId));
  }

  /**
   * Списание по факту: снимает резерв и уменьшает оба счёта одной транзакцией,
   * тут же записывая строку в журнал. Иначе при сбое между двумя запросами
   * баланс и история разошлись бы, а разобрать это потом нечем.
   *
   * **Строка магазина блокируется `FOR UPDATE`, и убирать `.for('update')`
   * нельзя.** Порядок карманов считается в приложении, между чтением остатка и
   * апдейтом: выразить «сколько взяли из подписочных» одним оператором можно
   * было бы только через RETURNING старых значений строки, а Postgres до 18-й
   * версии их не отдаёт. Без блокировки два параллельных списания прочитали бы
   * один и тот же подписочный остаток и оба сочли бы себя вправе его
   * потратить: при 3000 подписочных два списания по 3000 сняли бы 3000 с
   * подписки (`greatest(0, …)` съел бы вторую половину) и ноль с купленного —
   * то есть площадка подарила бы магазину 3000 кредитов на ровном месте.
   *
   * `greatest(0, …)` у обоих счетов — защита от ухода в минус: фактическая
   * стоимость может немного превысить резерв, и уйти ниже нуля нельзя.
   */
  async spend(
    shopId: number,
    reserved: number,
    credits: number,
    meta: CreditTxnMeta,
  ): Promise<{ balance: number; subscription: number }> {
    return this.db.transaction(async (tx) => {
      const before = await tx
        .select({ usable: sql<number>`${USABLE_SUBSCRIPTION_CREDITS}::int` })
        .from(shops)
        .where(eq(shops.id, shopId))
        .for('update');

      const { fromSubscription, fromBalance } = splitSpend(
        credits,
        before[0]?.usable ?? 0,
      );

      const rows = await tx
        .update(shops)
        .set({
          creditsReserved: sql`greatest(0, ${shops.creditsReserved} - ${reserved})`,
          subscriptionCredits: sql`greatest(0, ${shops.subscriptionCredits} - ${fromSubscription})`,
          creditsBalance: sql`greatest(0, ${shops.creditsBalance} - ${fromBalance})`,
        })
        .where(eq(shops.id, shopId))
        .returning({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
        });

      const balance = rows[0]?.balance ?? 0;
      const subscription = rows[0]?.subscription ?? 0;

      if (credits > 0) {
        await tx.insert(creditTransactions).values({
          shopId,
          kind: 'spend',
          amount: -credits,
          balanceAfter: balance,
          subscriptionAfter: subscription,
          meta: { ...meta, fromSubscription },
        });
      }

      return { balance, subscription };
    });
  }

  /**
   * Выдача кредитов. `authorId` бывает пустым: приветственные начисляет
   * система, а не человек, и подставлять туда администратора значило бы врать
   * в журнале — колонка на этот случай и объявлена nullable.
   *
   * Начисляется на купленный счёт: подарки и оплаченные пополнения не сгорают
   * никогда. Подписочная норма выдаётся не здесь, а в `grantSubscription` — у
   * неё другой счёт и другие правила сгорания.
   */
  async grant(data: {
    shopId: number;
    authorId: number | null;
    credits: number;
    note?: string;
    meta: CreditTxnMeta;
  }): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(shops)
        .set({
          creditsBalance: sql`${shops.creditsBalance} + ${data.credits}`,
        })
        .where(eq(shops.id, data.shopId))
        .returning({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
        });

      const balanceAfter = rows[0]?.balance ?? 0;

      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: data.authorId,
        kind: 'grant',
        amount: data.credits,
        balanceAfter,
        subscriptionAfter: rows[0]?.subscription ?? 0,
        note: data.note,
        meta: data.meta,
      });

      return balanceAfter;
    });
  }

  /**
   * Получал ли магазин выдачу по этой акции. Проверяется по журналу, а не по
   * флагу в магазине: журнал и так источник правды по деньгам, а лишняя
   * колонка разъехалась бы с ним при первом же ручном исправлении баланса.
   */
  async hasPromo(shopId: number, promo: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.shopId, shopId),
          sql`${creditTransactions.meta}->>'promo' = ${promo}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Есть ли у магазина хоть один оплаченный период (V6).
   *
   * Живёт в репозитории кредитов, а не подписок, по единственной причине:
   * `ShopsService` уже зависит от `CreditsService`, обратной зависимости нет, и
   * проверка перед удалением магазина не заводит нового кольца модулей.
   * Появится `SubscriptionsService` — метод логичнее перенести туда; пока его
   * нет, а удалять магазин с оплаченной подпиской нельзя уже сегодня.
   */
  async hasPaidSubscription(shopId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: subscriptionPayments.id })
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.shopId, shopId),
          eq(subscriptionPayments.status, 'paid'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Отобрать кредиты.
   *
   * Снимаем только из доступного: часть баланса бывает занята выполняющимся
   * сейчас запросом, и забрать её значило бы оборвать чужую генерацию на
   * полпути. Поэтому же строка магазина блокируется до конца транзакции —
   * иначе параллельное списание посчитало бы доступное по-своему.
   *
   * Ограничителя два, и оба обязательны (B5). `AVAILABLE_CREDITS` считает
   * резерв против обоих карманов сразу: у магазина с пустым купленным счётом,
   * тремя тысячами подписочных и тысячей в резерве прежняя формула
   * `balance − reserved` давала минус — то есть администратор не мог снять
   * вообще ничего, хотя снимать было что. Но и по одному только `available`
   * брать нельзя: у магазина с нулём купленных и тремя тысячами подписочных
   * `available` равен трём тысячам, и вычесть их из `credits_balance` значило
   * бы увести его в минус на всю подписочную норму. Снимается поэтому минимум
   * из двух — из купленного счёта и из доступного.
   *
   * Подписочные кредиты администратор не отбирает вовсе: это норма тарифа, за
   * который магазин заплатил, и отменяется она отменой подписки, а не правкой
   * баланса.
   *
   * Возвращаем реально снятое: администратор мог запросить больше, чем есть, и
   * сказать ему об этом честнее, чем молча снять сколько получилось.
   */
  async revoke(data: {
    shopId: number;
    authorId: number;
    credits: number;
    note?: string;
  }): Promise<{ taken: number; balance: number }> {
    return this.db.transaction(async (tx) => {
      const current = await tx
        .select({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
          available: sql<number>`${AVAILABLE_CREDITS}::int`,
        })
        .from(shops)
        .where(eq(shops.id, data.shopId))
        .for('update');

      const balance = current[0]?.balance ?? 0;
      const available = Math.max(
        0,
        Math.min(balance, current[0]?.available ?? 0),
      );
      const taken = Math.min(data.credits, available);
      if (taken === 0) return { taken: 0, balance };

      const rows = await tx
        .update(shops)
        .set({ creditsBalance: sql`${shops.creditsBalance} - ${taken}` })
        .where(eq(shops.id, data.shopId))
        .returning({
          balance: shops.creditsBalance,
          subscription: shops.subscriptionCredits,
        });

      const balanceAfter = rows[0]?.balance ?? 0;

      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: data.authorId,
        kind: 'adjust',
        amount: -taken,
        balanceAfter,
        subscriptionAfter: rows[0]?.subscription ?? current[0]?.subscription,
        note: data.note,
      });

      return { taken, balance: balanceAfter };
    });
  }

  /**
   * Занять бесплатную попытку автозаполнения одним оператором.
   *
   * Тот же приём, что в `reserve`: проверка «сколько уже потрачено» стоит в том
   * самом UPDATE, который счётчик и увеличивает. Пара «прочитали, потом
   * записали» отдала бы шестую бесплатную попытку двум параллельным нажатиям —
   * `@Throttle` пускает десять запросов в минуту, и добиться этого можно
   * обычным двойным кликом по кнопке.
   *
   * Сброс счётчика ленивый: якорь `autofill_period_month` не совпал с текущим
   * месяцем — счётчик пишется единицей вместе с новым якорем. Заданием по
   * расписанию это делать нельзя: оно гоняло бы все магазины ради строки,
   * которую большинство в этом месяце не откроет, и молча пропустило бы месяц
   * при простое сервиса.
   *
   * `limit` приходит снаружи, из `effectiveLimits` (B4), — здесь нет ни числа
   * пять, ни сравнения с `subscription_plan`. Единственное, что проверяется
   * прямо тут, — что подписка ещё жива (`SUBSCRIPTION_ACTIVE`, тот же
   * предикат, что у остальных гейтов): между гейтом в сервисе и этим
   * оператором помещается ровно та секунда, в которую подписка истекла, а
   * бесплатная попытка по истёкшему тарифу — уже подарок за чужой счёт.
   *
   * Пустой результат означает «бесплатной попытки нет»: либо норма
   * израсходована, либо подписки больше нет, либо магазин исчез. Различать эти
   * случаи вызывающему незачем — во всех трёх дальше платная ветка.
   */
  async claimFreeAutofill(
    shopId: number,
    month: string,
    limit: number,
  ): Promise<number | undefined> {
    const rows = await this.db
      .update(shops)
      .set({
        autofillFreeUsed: sql`case when ${shops.autofillPeriodMonth} = ${month}::date then ${shops.autofillFreeUsed} + 1 else 1 end`,
        autofillPeriodMonth: month,
      })
      .where(
        and(
          eq(shops.id, shopId),
          SUBSCRIPTION_ACTIVE,
          sql`(${shops.autofillPeriodMonth} is distinct from ${month}::date or ${shops.autofillFreeUsed} < ${limit})`,
        ),
      )
      .returning({ used: shops.autofillFreeUsed });
    return rows[0]?.used;
  }

  /**
   * Вернуть неиспользованную бесплатную попытку.
   *
   * Симметрично `claimFreeAutofill`: провалившийся запрос к модели не должен
   * съедать норму, как не съедает и кредиты. Условие по якорю обязательно —
   * без него откат запроса, начатого 31-го числа и упавшего 1-го, уменьшил бы
   * уже новый счётчик, подарив магазину лишнюю попытку в следующем месяце.
   * Сгоревшая на границе месяца попытка — цена честного счётчика, и цена эта
   * одна попытка в месяц у одного магазина.
   *
   * `greatest(0, …)` — от двойного отката: он ничего не стоит, а счётчик со
   * значением −1 дал бы шестую бесплатную попытку.
   */
  async releaseFreeAutofill(shopId: number, month: string): Promise<void> {
    await this.db
      .update(shops)
      .set({
        autofillFreeUsed: sql`greatest(0, ${shops.autofillFreeUsed} - 1)`,
      })
      .where(
        and(
          eq(shops.id, shopId),
          sql`${shops.autofillPeriodMonth} = ${month}::date`,
        ),
      );
  }

  /**
   * Выдать норму подписочных кредитов и продлить период — одной операцией,
   * внутри транзакции вызывающего (`complete()` платежа либо ручная
   * активация). Деньги и состояние подписки меняются вместе или не меняются
   * вовсе: подписка, выданная без записи о платеже, неотличима от подарка, а
   * платёж без подписки — от кражи.
   *
   * **Д1. Норма прибавляется, если подписка ещё жива, и присваивается, если
   * уже истекла.** Это не мелочь оформления, а разница в деньгах. Человек,
   * заплативший дважды подряд (двойное нажатие в приложении Click, оплата
   * заранее «чтобы не забыть»), при присвоении получил бы два месяца срока и
   * одну норму кредитов — вторая оплата купила бы ему только время. При
   * сложении он получает и два месяца, и две нормы, а условие тарифа
   * «обнуляется при каждой оплате» продолжает выполняться там, где оно и
   * задумано: подписка истекла, магазин вернулся — остаток прошлого периода
   * сгорает, выдаётся ровно норма тарифа, а не она плюс недоеденное.
   *
   * **Период считается здесь, под уже взятой блокировкой строки, а не
   * вызывающим.** Причина ровно та же, что и у нормы: два колбэка Complete,
   * пришедшие одновременно, прочитали бы один и тот же `subscription_until` и
   * оба посчитали бы от него — второй платёж не добавил бы ни дня. Поэтому на
   * вход идёт число месяцев, а не готовая дата: рассчитать её можно только
   * после `FOR UPDATE`, а до него правильного ответа попросту не существует.
   *
   * Начало периода — `now()` либо конец прежнего, если тот ещё не наступил:
   * оплата заранее не должна съедать уже оплаченные дни.
   *
   * Сгорание пишется отдельной строкой `adjust`, а не сворачивается с выдачей
   * в одно число: «начислено 4800» вместо «сожгли 1200, выдали 6000» — ровно
   * тот случай, когда продавец не может по журналу проверить площадку.
   *
   * Счётчик бесплатных автозаполнений не трогается намеренно: норма привязана
   * к календарному месяцу, а не к дате платежа, — так решено в тарифах, и так
   * проще объяснить продавцу.
   *
   * Тариф записывается тот, что купили, даже если он ниже действующего: выбор
   * сделал продавец, и подменять его покупку более дорогой мы не вправе. Если
   * продажу понижения посчитают нежелательной, отсекать её должен
   * `SubscriptionsService` до списания денег, а не выдача кредитов после.
   *
   * Цифры выдачи и сгорания пишутся на строку платежа здесь же, в том же
   * коммите. Оставить это вызывающему нельзя: между двумя запросами помещается
   * сбой, после которого кредиты выданы, а платёж стоит с пустыми
   * `granted_credits` — и разбирать спор «за что списали» будет уже нечем.
   *
   * Магазина нет — исключение, и вся транзакция вызывающего откатывается.
   * Отказ провайдеру с возвратом денег лучше, чем «оплачено, но некому».
   */
  async grantSubscription(
    data: {
      shopId: number;
      plan: PaidPlan;
      /** Сколько календарных месяцев куплено: 1 у Click, 1..12 у ручной активации. */
      months: number;
      /** Норма тарифа к выдаче; при ручной активации — норма, умноженная на месяцы. */
      credits: number;
      /** Строка платежа, породившая выдачу. `null` — выдача без платежа. */
      paymentId: number | null;
      /** Момент отсчёта. Параметром — чтобы не зависеть от часов в тестах. */
      now?: Date;
    },
    tx: Tx,
  ): Promise<SubscriptionGrantResult> {
    const now = data.now ?? new Date();

    const current = await tx
      .select({
        subscription: shops.subscriptionCredits,
        balance: shops.creditsBalance,
        until: shops.subscriptionUntil,
        active: sql<boolean>`${SUBSCRIPTION_ACTIVE}`,
      })
      .from(shops)
      .where(eq(shops.id, data.shopId))
      .for('update');

    const row = current[0];
    if (!row) {
      throw new NotFoundException(
        `Магазин ${data.shopId} не найден — подписку выдавать некому`,
      );
    }

    /**
     * «Жива ли подписка» спрашиваем у базы тем же предикатом, что и все
     * остальные гейты, а не сравниваем даты в JavaScript: часы приложения и
     * базы расходятся на секунды, и в эти секунды продление вело бы себя не
     * так, как показанный продавцу срок.
     */
    const alive = row.active === true;
    const from = alive && row.until ? row.until : now;
    const until = addMonths(from, data.months);

    const burned = alive ? 0 : (row.subscription ?? 0);
    const subscriptionAfter =
      (alive ? (row.subscription ?? 0) : 0) + data.credits;

    const updated = await tx
      .update(shops)
      .set({
        subscriptionPlan: data.plan,
        subscriptionUntil: until,
        subscriptionCredits: subscriptionAfter,
        updatedAt: now,
      })
      .where(eq(shops.id, data.shopId))
      .returning({ balance: shops.creditsBalance });

    const balanceAfter = updated[0]?.balance ?? row.balance ?? 0;

    if (burned > 0) {
      await tx.insert(creditTransactions).values({
        shopId: data.shopId,
        authorId: null,
        kind: 'adjust',
        amount: -burned,
        balanceAfter,
        subscriptionAfter: 0,
        note: SUBSCRIPTION_BURN_NOTE,
        meta: {
          promo: 'subscription_burn',
          plan: data.plan,
          paymentId: data.paymentId ?? undefined,
        },
      });
    }

    await tx.insert(creditTransactions).values({
      shopId: data.shopId,
      authorId: null,
      kind: 'grant',
      amount: data.credits,
      balanceAfter,
      subscriptionAfter,
      note: `${SUBSCRIPTION_GRANT_NOTE} ${data.plan.toUpperCase()}`,
      meta: {
        promo: 'subscription',
        plan: data.plan,
        paymentId: data.paymentId ?? undefined,
      },
    });

    if (data.paymentId !== null) {
      await tx
        .update(subscriptionPayments)
        .set({
          activatedFrom: from,
          activatedUntil: until,
          grantedCredits: data.credits,
          burnedCredits: burned,
        })
        .where(eq(subscriptionPayments.id, data.paymentId));
    }

    return { burned, granted: data.credits, from, until };
  }

  async history(shopId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    /**
     * Второй ключ сортировки обязателен: сгорание и выдача подписочной нормы
     * пишутся одной транзакцией, `created_at` у них совпадает до микросекунды,
     * и без `id` Postgres вправе показать их в любом порядке — в том числе
     * «начислено 6000, потом сожжено 1200», что читается как ограбление.
     */
    const data = await this.db
      .select({
        id: creditTransactions.id,
        kind: creditTransactions.kind,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        subscriptionAfter: creditTransactions.subscriptionAfter,
        note: creditTransactions.note,
        meta: creditTransactions.meta,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.shopId, shopId))
      .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.shopId, shopId))
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }
}
