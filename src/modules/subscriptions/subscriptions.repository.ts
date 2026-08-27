import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb, type Tx } from '../../db/db.provider';
import {
  shops,
  subscriptionPayments,
  subscriptionReminders,
  users,
  type Shop,
  type SubscriptionPayment,
  type SubscriptionPaymentMeta,
  type SubscriptionReminder,
} from '../../db/schema';
import { SUBSCRIPTION_ACTIVE, AVAILABLE_CREDITS } from '../../db/subscriptions';
import { escapeLike } from '../product-cards/product-search';
import {
  PaginationQueryDto,
  resolvePage,
} from '../../common/dto/pagination-query.dto';
import type { FindAdminSubscriptionsQueryDto } from './dto/find-admin-subscriptions-query.dto';
import type { SubscriptionPlanId } from './subscriptions.constants';

/**
 * Магазин в терминах платежа: кому выдавать период и кого потом уведомлять.
 *
 * Отдельный узкий тип, а не `Shop`, потому что здесь важно не «всё про
 * магазин», а три вещи: чей это магазин, как он называется и какой
 * telegram-id владельца уйдёт в кассу как `merchant_trans_id`.
 */
export interface PaymentShop {
  id: number;
  name: string;
  ownerId: number;
  ownerTelegramId: number;
}

/** Строка магазина под `FOR UPDATE` — всё, что нужно выдаче периода. */
export interface LockedShop {
  id: number;
  name: string;
  owner: number;
  status: Shop['status'];
  subscriptionPlan: SubscriptionPlanId;
  subscriptionUntil: Date | null;
}

/**
 * Сырое состояние подписки и обоих кошельков магазина.
 *
 * Именно сырое: `subscription_plan` и `subscription_until` отдаются как
 * лежат, а вывод «какой тариф действует» делает `effectiveLimits` в сервисе
 * (B4). Второй копии этого правила в репозитории быть не должно — она
 * разъехалась бы с первой ровно в ту секунду, когда срок истекает.
 */
export interface SubscriptionStateRow {
  subscriptionPlan: SubscriptionPlanId;
  subscriptionUntil: Date | null;
  subscriptionCredits: number;
  creditsBalance: number;
  creditsReserved: number;
  available: number;
  /** Бесплатных автозаполнений израсходовано в этом месяце — с якорем (V8). */
  autofillUsed: number;
}

/** Строка админского списка — до того, как сервис посчитает действующий тариф. */
export interface AdminSubscriptionRow {
  shopId: number;
  shopName: string;
  shopStatus: Shop['status'];
  ownerId: number;
  ownerName: string;
  ownerUsername: string | null;
  storedPlan: SubscriptionPlanId;
  until: Date | null;
  subscriptionCredits: number;
  lastPaidAt: Date | null;
  stuckPrepared: boolean;
  needsManualReview: boolean;
}

/** Магазин, которому пора напомнить об истечении подписки. */
export interface ReminderCandidate {
  shopId: number;
  shopName: string;
  ownerId: number;
  /** Срок на момент выборки — он же третий столбец ключа идемпотентности. */
  expiresAt: Date;
  /** Полных календарных суток до истечения по Ташкенту: 0..`leadDays`. */
  daysLeft: number;
}

/**
 * Весь SQL подписок: журнал платежей и колонки `shops.subscription_*`.
 *
 * Репозиторий намеренно ничего не решает — ни какой тариф действует, ни
 * можно ли выдать период. Он умеет только читать, писать и брать блокировки;
 * все правила живут в `SubscriptionsService` и в `subscriptions.constants.ts`.
 * Причина не в чистоте слоёв, а в том, что правила подписки нужны ещё и
 * кредитам, витрине и баннерам, которые до этого файла не дотягиваются вовсе.
 *
 * Транзакция отдаётся наружу методом `transaction`, а не прячется внутри
 * отдельных операций: выдача подписки — это одновременно строка платежа,
 * колонки магазина и две записи в журнале кредитов, причём кредиты пишет
 * чужой репозиторий. Один коммит на всё это можно собрать только у
 * вызывающего.
 */
@Injectable()
export class SubscriptionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Один коммит на платёж, кредиты и колонки магазина. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  /**
   * Дописать в `meta`, не затирая уже накопленное.
   *
   * `jsonb ||`, а не присвоение целиком: за жизнь платежа в мету пишут трижды
   * из разных мест — Prepare кладёт `service_id`, отмена дописывает причину,
   * разбор ставит «требует ручной проверки», — и присвоение стёрло бы всё,
   * что положили раньше. `coalesce` нужен потому, что колонка nullable:
   * `null || '{...}'` в Postgres даёт `null`, то есть молча ничего не запишет.
   *
   * `JSON.stringify` попутно выбрасывает поля со значением `undefined` — это
   * ровно то, что нужно: необязательные поля патча просто не попадут в строку
   * вместо того, чтобы записаться нулями.
   */
  private static mergeMeta(patch: SubscriptionPaymentMeta): SQL {
    return sql`coalesce(${subscriptionPayments.meta}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
  }

  /**
   * Записать Prepare, ничего не делая при конфликте.
   *
   * **`onConflictDoNothing()` без таргета — так и задумано (V1).** Таблицу
   * защищают два уникальных индекса: по `click_trans_id` и по
   * `click_paydoc_id`. Указав таргетом первый, мы бы разрешили второй случай —
   * один списанный платёжный документ, пришедший под двумя разными номерами
   * транзакции, — и оплатили бы два периода за одни деньги. Без таргета
   * конфликт по документу тоже гасится, но последующий поиск по
   * `click_trans_id` строку не найдёт, вызывающий бросит и ответит `-8`. Это
   * происходит на Prepare, то есть до списания: отказ там не стоит никому
   * ничего.
   */
  async insertPrepared(
    tx: Tx,
    data: {
      shopId: number;
      /**
       * `free` — тестовая оплата: покупать было нечего, и записать сюда
       * похожий по цене тариф значило бы соврать журналу. Отличается она от
       * прочих `free`-строк (несостоявшийся Complete с суммой мимо прайса)
       * пометкой `meta.test`.
       */
      plan: SubscriptionPlanId;
      amount: number;
      providerTransactionId: string;
      providerPaymentId: string;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: 'click',
        plan: data.plan,
        amount: data.amount,
        status: 'prepared',
        providerTransactionId: data.providerTransactionId,
        providerPaymentId: data.providerPaymentId,
        meta: data.meta,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  /**
   * Найти и заблокировать платёж по номеру транзакции провайдера.
   *
   * `click_trans_id` — единственный документированный ключ идемпотентности
   * (B2), и поиск идёт строго по нему. Добавить в условие ещё и номер
   * документа с номером счёта значило бы отвечать «транзакции не существует»
   * на Complete по уже списанной карте всякий раз, когда разошёлся любой из
   * трёх реквизитов, — и не оставлять следа нигде. Реквизиты сверяются
   * отдельно, над найденной строкой.
   */
  async lockByProviderTransaction(
    tx: Tx,
    providerTransactionId: string,
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.provider, 'click'),
          eq(subscriptionPayments.providerTransactionId, providerTransactionId),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0];
  }

  /** Запомнить выданный провайдеру номер счёта. */
  async setPrepareId(
    tx: Tx,
    id: number,
    prepareId: string,
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({ providerPrepareId: prepareId })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  /** Платёж состоялся: период выдан, деньги списаны. */
  async markPaid(
    tx: Tx,
    id: number,
    data: {
      /**
       * `null` — у тестовой оплаты: периода она не покупает. Пустые даты здесь
       * обязательны, а не удобны: по `activated_until` считается инвариант
       * «`subscription_until` равен максимальному среди оплаченных», и любая
       * дата на тестовой строке заставила бы её притворяться купленным
       * периодом в глазах админки и крона напоминаний.
       */
      activatedFrom: Date | null;
      activatedUntil: Date | null;
      grantedCredits: number;
      burnedCredits: number;
      paidAt: Date;
    },
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({
        status: 'paid',
        activatedFrom: data.activatedFrom,
        activatedUntil: data.activatedUntil,
        grantedCredits: data.grantedCredits,
        burnedCredits: data.burnedCredits,
        paidAt: data.paidAt,
        /**
         * Снимается намеренно: строка могла побывать отменённой (провайдер
         * прислал отмену, потом повторил Complete успешно), и дата отмены на
         * оплаченном платеже читается как «оплачен и тут же возвращён».
         */
        cancelledAt: null,
      })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  /** Платёж отменён — провайдером или нами при возврате. */
  async markCancelled(
    tx: Tx,
    id: number,
    meta: SubscriptionPaymentMeta,
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        meta: SubscriptionsRepository.mergeMeta(meta),
      })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  /** Дописать в мету, не трогая статус — для уже оплаченных строк (Д3). */
  async patchMeta(
    tx: Tx,
    id: number,
    meta: SubscriptionPaymentMeta,
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .update(subscriptionPayments)
      .set({ meta: SubscriptionsRepository.mergeMeta(meta) })
      .where(eq(subscriptionPayments.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Завести строку об отказавшем Complete, когда Prepare до нас не доходил.
   *
   * Конфликт гасится без таргета по той же причине, что и в `insertPrepared`:
   * номер документа мог быть уже использован другой строкой, и заводить
   * вторую нельзя. Пустой результат означает «место занято» — вызывающему
   * останется только запись в журнале приложения, и это лучше исключения:
   * метод зовут в тот момент, когда деньги уже списаны и главное — не
   * уронить обработчик колбэка.
   */
  async insertCancelled(
    tx: Tx,
    data: {
      shopId: number;
      plan: SubscriptionPlanId;
      amount: number;
      providerTransactionId: string;
      providerPaymentId: string;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment | undefined> {
    const rows = await tx
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: 'click',
        plan: data.plan,
        amount: data.amount,
        status: 'cancelled',
        providerTransactionId: data.providerTransactionId,
        providerPaymentId: data.providerPaymentId,
        cancelledAt: new Date(),
        meta: data.meta,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  /**
   * Строка ручной операции администратора — активации или отмены.
   *
   * Сразу со статусом `paid`, без стадии `prepared`: двухфазность — это
   * протокол провайдера, а здесь решение принято и исполнено одним действием
   * человека. Идентификаторов провайдера у такой строки нет вовсе, и оба
   * уникальных индекса её пропускают: `NULL` в Postgres не равен `NULL`, так
   * что ручные активации не мешают ни друг другу, ни платежам Click.
   *
   * `initiatorId` заполняется только здесь. У платежей Click строку заводит
   * колбэк Prepare, где аутентифицированного пользователя не существует —
   * приходит запрос от робота провайдера, а не от человека.
   */
  async insertManual(
    tx: Tx,
    data: {
      shopId: number;
      plan: SubscriptionPlanId;
      amount: number;
      initiatorId: number;
      paidAt: Date;
      activatedFrom?: Date | null;
      activatedUntil?: Date | null;
      grantedCredits?: number | null;
      burnedCredits?: number | null;
      meta: SubscriptionPaymentMeta;
    },
  ): Promise<SubscriptionPayment> {
    const rows = await tx
      .insert(subscriptionPayments)
      .values({
        shopId: data.shopId,
        provider: 'manual',
        plan: data.plan,
        amount: data.amount,
        status: 'paid',
        initiatorId: data.initiatorId,
        paidAt: data.paidAt,
        activatedFrom: data.activatedFrom ?? null,
        activatedUntil: data.activatedUntil ?? null,
        grantedCredits: data.grantedCredits ?? null,
        burnedCredits: data.burnedCredits ?? null,
        meta: data.meta,
      })
      .returning();
    return rows[0];
  }

  /**
   * Была ли ручная активация только что (Д2, идемпотентность).
   *
   * У ручной активации нет идентификатора провайдера, по которому можно было
   * бы отличить повтор от нового решения администратора, — остаётся время.
   * Запрос обязан идти в той же транзакции и после блокировки магазина, иначе
   * два запроса, пришедшие одновременно, оба увидят пустой результат.
   *
   * Компенсирующие строки отмены под это условие не подпадают: у них
   * `granted_credits = 0`. Без этой оговорки администратор, отменивший
   * подписку по ошибке, не смог бы вернуть её целую минуту — и получил бы в
   * ответ сообщение про двойное нажатие, к его действию не относящееся.
   */
  async hasRecentManual(
    tx: Tx,
    shopId: number,
    seconds: number,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: subscriptionPayments.id })
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.shopId, shopId),
          eq(subscriptionPayments.provider, 'manual'),
          eq(subscriptionPayments.status, 'paid'),
          sql`coalesce(${subscriptionPayments.grantedCredits}, 0) > 0`,
          sql`${subscriptionPayments.createdAt} > now() - (${seconds}::int * interval '1 second')`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Заблокировать магазин под выдачу периода.
   *
   * Без этой блокировки два платежа, пришедшие одновременно (продавец нажал
   * «оплатить» в двух вкладках), прочитали бы один и тот же
   * `subscription_until`, и второй затёр бы период первого — оплаченный месяц
   * просто исчез бы. `status` отдаётся наружу, чтобы вызывающий перепроверил
   * его уже под взятой блокировкой (V3): между разрешением магазина в начале
   * колбэка и этим моментом помещается упразднение магазина администратором.
   */
  async lockShop(tx: Tx, shopId: number): Promise<LockedShop | undefined> {
    const rows = await tx
      .select({
        id: shops.id,
        name: shops.name,
        owner: shops.owner,
        status: shops.status,
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1)
      .for('update');
    return rows[0];
  }

  /**
   * Взвести окно тестовой оплаты для магазина.
   *
   * Присваиванием, а не «продлить, если уже открыто»: администратор, нажавший
   * кнопку второй раз, ждёт свежие полчаса от этого нажатия, а не остаток от
   * прошлого. Возвращает магазин, только если он активен, — взводить окно
   * упразднённому незачем, а молчаливое взведение в никуда выглядело бы как
   * рабочая кнопка.
   */
  async armTestWindow(
    shopId: number,
    until: Date,
  ): Promise<PaymentShop | undefined> {
    const rows = await this.db
      .update(shops)
      .set({ subscriptionTestUntil: until, updatedAt: new Date() })
      .where(and(eq(shops.id, shopId), eq(shops.status, 'active')))
      .returning({ id: shops.id, name: shops.name, ownerId: shops.owner });

    const row = rows[0];
    if (!row) return undefined;

    const owner = await this.db
      .select({ telegramId: users.telegramId })
      .from(users)
      .where(eq(users.id, row.ownerId))
      .limit(1);
    if (!owner[0]) return undefined;

    return { ...row, ownerTelegramId: owner[0].telegramId };
  }

  /**
   * Открыто ли окно прямо сейчас. Читается на Prepare, когда сумма не совпала
   * ни с одним тарифом, — то есть редко и по уже найденному магазину.
   *
   * Сравнение делает Postgres (`now()`), а не приложение: часы контейнера и
   * часы базы расходятся, и окно, открытое базой, должно ею же и закрываться.
   */
  async isTestWindowOpen(shopId: number): Promise<boolean> {
    const rows = await this.db
      .select({ open: sql<boolean>`${shops.subscriptionTestUntil} > now()` })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return rows[0]?.open === true;
  }

  /**
   * Закрыть окно. Зовётся в транзакции успешного Complete: окно одноразовое,
   * и оставить его открытым на остаток получаса значило бы разрешить второй
   * тестовый платёж, которого никто не просил.
   */
  async closeTestWindow(tx: Tx, shopId: number): Promise<void> {
    await tx
      .update(shops)
      .set({ subscriptionTestUntil: null, updatedAt: new Date() })
      .where(eq(shops.id, shopId));
  }

  /**
   * Магазин по telegram-id владельца — так приходит `merchant_trans_id` (V4).
   *
   * Одна ветка и никакого запасного поиска по `shops.id`: два способа
   * истолковать одно число означают, что однажды они истолкуют его по-разному.
   * Фильтр `status = 'active'` обязателен — продавать подписку витрине,
   * которой нет, нельзя; отказ приходит на Prepare, где деньги ещё не списаны.
   */
  async findShopByOwnerTelegramId(
    telegramId: number,
  ): Promise<PaymentShop | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(and(eq(users.telegramId, telegramId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  /** Тот же магазин, но найденный по владельцу — для сборки ссылки на кассу. */
  async findShopByOwner(ownerId: number): Promise<PaymentShop | undefined> {
    const rows = await this.db
      .select({
        id: shops.id,
        name: shops.name,
        ownerId: users.id,
        ownerTelegramId: users.telegramId,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(and(eq(shops.owner, ownerId), eq(shops.status, 'active')))
      .limit(1);
    return rows[0];
  }

  /**
   * Состояние подписки и кошельков одним запросом.
   *
   * `::int` на всех вычисляемых полях обязателен (V5): `credits_balance`,
   * `subscription_credits` и `credits_reserved` — `bigint`, а выражение над
   * ними node-postgres отдаёт строкой, потому что парсеров типов в
   * `db.provider.ts` нет. Без каста `available` приехал бы как `"2900"`, а
   * дальше это сравнивается с числом и складывается — то есть даёт то `false`
   * на непустом остатке, то склейку строк вместо суммы.
   *
   * Счётчик автозаполнений читается с якорем месяца (V8), а не напрямую из
   * колонки: сброс ленивый и живёт внутри `claimFreeAutofill`, поэтому первого
   * числа в колонке ещё лежит прошлое число. Прочитав его как есть, страница
   * подписки объявила бы норму израсходованной ровно в тот день, когда она
   * обновилась.
   */
  async stateOf(
    shopId: number,
    month: string,
  ): Promise<SubscriptionStateRow | undefined> {
    const rows = await this.db
      .select({
        subscriptionPlan: shops.subscriptionPlan,
        subscriptionUntil: shops.subscriptionUntil,
        subscriptionCredits: sql<number>`${shops.subscriptionCredits}::int`,
        creditsBalance: sql<number>`${shops.creditsBalance}::int`,
        creditsReserved: sql<number>`${shops.creditsReserved}::int`,
        available: sql<number>`${AVAILABLE_CREDITS}::int`,
        autofillUsed: sql<number>`(case when ${shops.autofillPeriodMonth} = ${month}::date then ${shops.autofillFreeUsed} else 0 end)::int`,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    return rows[0];
  }

  /**
   * Оборвать оплаченный период здесь и сейчас (админская отмена).
   *
   * `subscription_credits` не трогаем намеренно: они запираются предикатом
   * `USABLE_SUBSCRIPTION_CREDITS` и вернутся при новой оплате — ровно так же,
   * как при естественном истечении срока. Обнулять их отдельной веткой значило
   * бы завести второе поведение там, где хватает одного, и отобрать у продавца
   * то, за что он уже заплатил.
   *
   * `subscription_plan` тоже остаётся прежним — колонка намеренно помнит, чем
   * магазин пользовался (B4), а прав она сама по себе не даёт.
   */
  async expireSubscription(tx: Tx, shopId: number, now: Date): Promise<void> {
    await tx
      .update(shops)
      .set({ subscriptionUntil: now, updatedAt: now })
      .where(eq(shops.id, shopId));
  }

  /** Журнал платежей магазина — свежим вперёд. */
  async paymentsOf(shopId: number, query: PaginationQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const data = await this.db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.shopId, shopId))
      .orderBy(
        desc(subscriptionPayments.createdAt),
        desc(subscriptionPayments.id),
      )
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.shopId, shopId))
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }

  /**
   * Подписки для админки.
   *
   * Фильтр по тарифу выражен `SUBSCRIPTION_ACTIVE` вместе с равенством
   * колонки, а не одним равенством (B4). Голое
   * `subscription_plan = 'max'` вернуло бы всех, кто когда-либо покупал MAX,
   * включая бросивших платить полгода назад: колонка после истечения
   * намеренно сохраняет купленный тариф. Пара «план и живой срок» — это то же
   * самое условие, что считает `effectiveLimits`, только выраженное SQL'ем,
   * потому что фильтровать страницу в приложении нельзя: пагинация даёт
   * пустые страницы там, где отсеялось всё.
   *
   * `free` в этом фильтре означает «действующей подписки нет» — и просроченных
   * бывших подписчиков он тоже показывает. Так и задумано: администратор
   * спрашивает «кто сейчас без тарифа», а не «у кого в колонке лежит free».
   *
   * Два флага-колонки считаются подзапросами `EXISTS`, а не соединением с
   * платежами: соединение размножило бы строку магазина по числу платежей и
   * потребовало бы `GROUP BY` со всеми колонками сразу.
   */
  async adminList(query: FindAdminSubscriptionsQueryDto): Promise<{
    data: AdminSubscriptionRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, offset } = resolvePage(query);

    const stuckPrepared = sql<boolean>`${exists(
      this.db
        .select({ one: sql`1` })
        .from(subscriptionPayments)
        .where(
          and(
            eq(subscriptionPayments.shopId, shops.id),
            eq(subscriptionPayments.status, 'prepared'),
            sql`${subscriptionPayments.createdAt} < now() - interval '1 day'`,
          ),
        ),
    )}`;

    const needsManualReview = sql<boolean>`${exists(
      this.db
        .select({ one: sql`1` })
        .from(subscriptionPayments)
        .where(
          and(
            eq(subscriptionPayments.shopId, shops.id),
            sql`${subscriptionPayments.meta}->>'needsManualReview' = 'true'`,
          ),
        ),
    )}`;

    const conditions: SQL[] = [];

    if (query.plan) {
      conditions.push(
        query.plan === 'free'
          ? sql`NOT ${SUBSCRIPTION_ACTIVE}`
          : sql`(${eq(shops.subscriptionPlan, query.plan)} AND ${SUBSCRIPTION_ACTIVE})`,
      );
    }

    if (query.expiring_days !== undefined) {
      conditions.push(
        sql`(${SUBSCRIPTION_ACTIVE} AND ${shops.subscriptionUntil} <= now() + (${query.expiring_days}::int * interval '1 day'))`,
      );
    }

    if (query.needs_review) conditions.push(needsManualReview);

    const search = query.q?.trim();
    if (search) {
      /** «%» и «_» из строки поиска — это ввод человека, а не шаблон LIKE. */
      const pattern = `%${escapeLike(search)}%`;
      const like = or(
        ilike(shops.name, pattern),
        ilike(shops.contact, pattern),
        ilike(users.fullname, pattern),
        ilike(users.telegramUsername, pattern),
      );
      if (like) conditions.push(like);
    }

    const where = conditions.length ? and(...conditions) : undefined;

    /**
     * При включённом фильтре «истекает» сверху нужны ближайшие к концу срока,
     * в остальных случаях — самые свежие подписки. Один и тот же порядок для
     * обоих случаев означал бы, что вкладка «истекают» открывается на тех, у
     * кого до конца дальше всех.
     */
    const order =
      query.expiring_days !== undefined
        ? sql`${shops.subscriptionUntil} asc nulls last`
        : sql`${shops.subscriptionUntil} desc nulls last`;

    const data = await this.db
      .select({
        shopId: shops.id,
        shopName: shops.name,
        shopStatus: shops.status,
        ownerId: users.id,
        ownerName: users.fullname,
        ownerUsername: users.telegramUsername,
        storedPlan: shops.subscriptionPlan,
        until: shops.subscriptionUntil,
        subscriptionCredits: sql<number>`${shops.subscriptionCredits}::int`,
        lastPaidAt: sql<Date | null>`(select max(${subscriptionPayments.paidAt}) from ${subscriptionPayments} where ${subscriptionPayments.shopId} = ${shops.id} and ${subscriptionPayments.status} = 'paid')`,
        stuckPrepared,
        needsManualReview,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(where)
      .orderBy(order, desc(shops.id))
      .limit(limit)
      .offset(offset);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(where)
      .then((rows) => rows[0]?.count ?? 0);

    return { data, total, page, limit };
  }

  /**
   * Кому пора напомнить об истечении подписки.
   *
   * Календарная дата в поясе площадки, а не арифметика над `timestamptz`:
   * `now() + interval '3 days'` означает «за трое суток и сколько-то часов», и
   * попадание в окно зависело бы от того, во сколько человек когда-то оплатил.
   *
   * Окно `0..leadDays`, а не точная дата (V10 плюс поведение планировщика):
   * `@nestjs/schedule` пропущенные срабатывания не догоняет, и контейнер,
   * лежавший в момент запуска задачи, потерял бы этап целиком. С окном он
   * догонится сам, а от повторной отправки защищает уникальный индекс
   * `subscription_reminders_once_idx`.
   *
   * `subscription_until > now()` обязателен (V10): напоминание об оплате по
   * уже истёкшей или отменённой администратором подписке — не напоминание, а
   * недоразумение. Заблокированных владельцев не берём вовсе — им нельзя
   * писать. Фильтра «достижим в Telegram» здесь намеренно нет: push уходит и
   * тем, у кого чата с ботом не открыто, а делить получателей по каналам —
   * работа отправляющего (V9).
   */
  async reminderCandidates(leadDays: number): Promise<ReminderCandidate[]> {
    return this.db
      .select({
        shopId: shops.id,
        shopName: shops.name,
        ownerId: users.id,
        /**
         * Пустым `subscription_until` здесь быть не может: `SUBSCRIPTION_ACTIVE`
         * требует `> now()`. Обёртка в `sql` нужна ровно затем, чтобы это знание
         * попало в тип и вызывающему не пришлось разбирать `null`, которого не
         * бывает.
         */
        expiresAt: sql<Date>`${shops.subscriptionUntil}`,
        daysLeft: sql<number>`((${shops.subscriptionUntil} AT TIME ZONE 'Asia/Tashkent')::date - (now() AT TIME ZONE 'Asia/Tashkent')::date)::int`,
      })
      .from(shops)
      .innerJoin(users, eq(shops.owner, users.id))
      .where(
        and(
          eq(shops.status, 'active'),
          SUBSCRIPTION_ACTIVE,
          sql`${users.blockedAt} is null`,
          sql`(${shops.subscriptionUntil} AT TIME ZONE 'Asia/Tashkent')::date between (now() AT TIME ZONE 'Asia/Tashkent')::date and (now() AT TIME ZONE 'Asia/Tashkent')::date + ${leadDays}::int`,
        ),
      )
      .orderBy(shops.subscriptionUntil);
  }

  /**
   * Занять право на отправку — вставкой ДО обращения к Telegram.
   *
   * Отметка после доставки (как у `SellerNudgeService`) при падении процесса
   * на середине пачки повторила бы рассылку всем, кто уже получил. Redis-claim
   * для этого непригоден: он fails open и без Redis пропускает всех.
   *
   * Возвращаются только те строки, которые вставились. Остальные — уже
   * отправленные, и повторять их не нужно.
   */
  async claimReminders(
    rows: {
      shopId: number;
      stage: SubscriptionReminder['stage'];
      expiresAt: Date;
    }[],
  ): Promise<{ id: number; shopId: number }[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(subscriptionReminders)
      .values(rows)
      .onConflictDoNothing()
      .returning({
        id: subscriptionReminders.id,
        shopId: subscriptionReminders.shopId,
      });
  }

  /**
   * Записать, чем кончилась отправка. Одной транзакцией на пачку: строк
   * столько же, сколько получателей, а отдельный коммит на каждую означал бы
   * сотню круговых поездок к базе ради двух чисел.
   */
  async confirmReminders(
    updates: { id: number; telegram: boolean; push: number }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(subscriptionReminders)
          .set({
            telegramDelivered: update.telegram,
            pushDelivered: update.push,
          })
          .where(eq(subscriptionReminders.id, update.id));
      }
    });
  }

  /**
   * Освободить право на отправку, если не сработал ни один канал: завтрашний
   * прогон попробует ещё раз. Оставить строку значило бы навсегда записать
   * человеку «предупреждён» по неудавшейся попытке.
   */
  async releaseReminders(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(subscriptionReminders)
      .where(inArray(subscriptionReminders.id, ids));
  }

  /**
   * Ретенция журнала напоминаний. Строки нужны ровно до тех пор, пока по ним
   * можно разобрать жалобу «меня не предупредили»; год с запасом — предел, за
   * которым они только занимают место.
   */
  async purgeReminders(days: number): Promise<number> {
    const rows = await this.db
      .delete(subscriptionReminders)
      .where(
        sql`${subscriptionReminders.createdAt} < now() - (${days}::int * interval '1 day')`,
      )
      .returning({ id: subscriptionReminders.id });
    return rows.length;
  }
}
