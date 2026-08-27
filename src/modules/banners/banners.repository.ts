import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { banners, shops, type NewBanner } from '../../db/schema';
import { SUBSCRIPTION_ACTIVE } from '../../db/subscriptions';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import { MAX_ACTIVE_BANNERS } from './banners.constants';
import { FindShopBannersQueryDto } from './dto/find-shop-banners-query.dto';

/**
 * Колонки, которые видит покупатель.
 *
 * Список явный, и это главное требование к публичной выборке. Прежний
 * `db.query.banners.findMany` отдавал строку целиком, то есть каждая новая
 * колонка попадала в публичный ответ сама, без единой правки здесь, — а
 * колонки у баннера появились такие, что этого допустить нельзя:
 * `reject_reason` пишет администратор продавцу человеческим языком, и утечь на
 * главную страницу этот текст не должен ни при какой ошибке.
 *
 * `is_active` и `sort_order` тоже не отдаются: первое у всякого баннера этой
 * выдачи равно `true` по условию запроса, второе бессмысленно для баннеров
 * продавцов (их порядок задаёт ротация) и в любом случае уже выражено порядком
 * элементов массива.
 */
const PUBLIC_COLUMNS = {
  id: banners.id,
  title: banners.title,
  photoRu: banners.photoRu,
  photoUzLatn: banners.photoUzLatn,
  photoUzCyrl: banners.photoUzCyrl,
  linkUrl: banners.linkUrl,
} as const;

/**
 * Колонки для кабинета продавца и админки: к публичным добавлены управление
 * (`is_active`, `sort_order`) и вся модерация.
 *
 * `moderated_by` наружу не отдаётся ни в одной из двух выдач — это внутренний
 * id администратора: продавцу он ничего не объясняет, а админке без имени
 * бесполезен. Понадобится «кто решил» — это join к `users` и колонка с именем,
 * а не голое число в ответе.
 */
const BANNER_COLUMNS = {
  ...PUBLIC_COLUMNS,
  isActive: banners.isActive,
  sortOrder: banners.sortOrder,
  shopId: banners.shopId,
  status: banners.status,
  rejectReason: banners.rejectReason,
  moderatedAt: banners.moderatedAt,
  createdAt: banners.createdAt,
  updatedAt: banners.updatedAt,
} as const;

@Injectable()
export class BannersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Площадочные баннеры витрины: включённые, прошедшие модерацию, в заданном
   * администратором порядке, с потолком на длину.
   *
   * `status = 'approved'` обязателен по двум причинам, и обе появились вместе
   * с баннерами продавцов (миграция 0040).
   *
   * Первая — сегодняшняя. Условие обязано дословно повторять предикат
   * частичного `banners_public_idx` (`is_active AND status = 'approved'`),
   * иначе индекс не будет использован вовсе: планировщик берёт частичный
   * индекс, только если предикат запроса влечёт предикат индекса, а
   * `is_active = true` сам по себе ничего не говорит про `status`. Прежний
   * `banners_active_sort_idx` той же миграцией удалён, так что запросу без
   * этой половины условия остался бы только seqscan по всей таблице.
   *
   * Вторая — завтрашняя. Баннер продавца заводится со статусом `pending`, и
   * без проверки статуса он попал бы на главную страницу сразу после загрузки,
   * минуя модерацию, — то есть ровно то, ради чего колонка и заведена.
   * Проверка стоит здесь, а не только в гейте создания: витрина решает, что
   * показывать, и полагаться на аккуратность всех, кто когда-либо вставит
   * строку, она не должна.
   *
   * `shop_id IS NULL` отделяет площадочные от продавцовых. Две дешёвые выборки
   * вместо одной — потому что у половин разный порядок (здесь `sort_order`,
   * там ротация) и разные условия отбора; выразить это одним `ORDER BY` можно
   * только через `CASE`, а он убьёт оба индекса разом.
   */
  findActivePlatform(limit: number = MAX_ACTIVE_BANNERS) {
    return this.db
      .select(PUBLIC_COLUMNS)
      .from(banners)
      .where(
        and(
          isNull(banners.shopId),
          eq(banners.isActive, true),
          eq(banners.status, 'approved'),
        ),
      )
      .orderBy(asc(banners.sortOrder), asc(banners.id))
      .limit(limit);
  }

  /**
   * Баннеры продавцов на витрине: показываются, только пока у магазина жив
   * тариф MAX. Право на карусель даёт подписка, а не сама строка, поэтому
   * отдельной даты окончания у баннера нет — она разъезжалась бы с подпиской и
   * потребовала бы крона, который её подтягивает.
   *
   * **Здесь `subscription_plan` читается напрямую — это то самое исключение из
   * правила B4** («действующий тариф узнаётся только через `effectiveLimits`»).
   * Исключение вынужденное: гейт нужен внутри `WHERE`, а перебирать в JS
   * баннеры всех магазинов, чтобы отсеять их функцией, значит выбрать заведомо
   * ненужное и отфильтровать уже после базы. Условие ниже — SQL-запись того же
   * самого предиката: `effectiveLimits(shop).bannerSlots > 0` истинно ровно
   * тогда, когда план `max` и срок ещё не вышел (см. `PLAN_LIMITS` — слот
   * баннера есть только у MAX). Половину «срок не вышел» берём готовым
   * выражением `SUBSCRIPTION_ACTIVE`, чтобы строгость сравнения (`>`, а не
   * `>=`) не разъехалась с остальным приложением; вторая его половина, «план
   * не free», рядом с `plan = 'max'` избыточна — но выкинуть её можно только
   * вместе с самим выражением, то есть скопировав сюда сравнение со сроком и
   * взявшись следить за двумя копиями. Второе такое же исключение из B4 —
   * `promoWeightSql` в `ORDER BY` витрины товаров; третьего быть не должно.
   *
   * `shops.status = 'active'` — отдельная проверка: упразднённый магазин
   * подписку не теряет, и без этого условия его баннер провисел бы на главной
   * до конца оплаченного срока.
   *
   * Порядок — ротацией по `md5(зерно || id)`, а не по `sort_order`:
   * подписчиков с баннером может быть больше, чем мест, и фиксированный
   * порядок означал бы, что часть из них не увидят никогда. Зерно неподвижно
   * внутри окна ротации — разбор в докблоке `bucketKey`.
   */
  findActiveShop(bucket: string, limit: number) {
    return this.db
      .select(PUBLIC_COLUMNS)
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(
        and(
          eq(banners.isActive, true),
          eq(banners.status, 'approved'),
          eq(shops.status, 'active'),
          eq(shops.subscriptionPlan, 'max'),
          SUBSCRIPTION_ACTIVE,
        ),
      )
      .orderBy(sql`md5(${bucket} || ${banners.id}::text)`)
      .limit(limit);
  }

  /**
   * Админский список карусели: все площадочные, включая выключенные, в том же
   * порядке — список без листалки, каким его ждёт существующая страница.
   *
   * `shop_id IS NULL` здесь не косметика, а инвариант перестановки: `reorder`
   * раздаёт позиции 0..n-1 по списку id, а `applyOrder` бьёт `inArray(id,
   * ids)` без фильтра по владельцу. Попади баннер продавца в этот список,
   * админка отправила бы его id в `reorder` вместе с остальными и переставила
   * бы чужой баннер — при том что порядок продавцовых задаёт ротация и
   * `sort_order` у них не значит ничего. Баннеры магазинов администратор
   * смотрит и решает их судьбу в `/admin/shop-banners`.
   */
  findAll() {
    return this.db
      .select(BANNER_COLUMNS)
      .from(banners)
      .where(isNull(banners.shopId))
      .orderBy(asc(banners.sortOrder), asc(banners.id));
  }

  findById(id: number) {
    return this.db.query.banners.findFirst({ where: eq(banners.id, id) });
  }

  /** Кабинет продавца: его баннеры, свежие сверху. */
  findOwned(shopId: number) {
    return this.db
      .select(BANNER_COLUMNS)
      .from(banners)
      .where(eq(banners.shopId, shopId))
      .orderBy(desc(banners.createdAt));
  }

  /**
   * Владение и существование одним запросом: id, не принадлежащий магазину, —
   * это «не найден», а не «чужой», и разделять два ответа нельзя. Иначе
   * разница между 403 и 404 превращается в способ пересчитать чужие баннеры.
   */
  findOwnedByIdAndShop(id: number, shopId: number) {
    return this.db
      .select(BANNER_COLUMNS)
      .from(banners)
      .where(and(eq(banners.id, id), eq(banners.shopId, shopId)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Сколько баннеров у магазина уже есть — против лимита слотов тарифа. */
  async countOwned(shopId: number): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(banners)
      .where(eq(banners.shopId, shopId));
    return rows[0]?.count ?? 0;
  }

  /**
   * Очередь модерации. `innerJoin` к магазину не только даёт название для
   * списка, но и служит фильтром «только баннеры продавцов»: у площадочных
   * `shop_id` пуст, и соединение их не пропустит.
   */
  async findShopBanners(query: FindShopBannersQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const where = and(
      query.status ? eq(banners.status, query.status) : undefined,
      query.shop_id ? eq(banners.shopId, query.shop_id) : undefined,
    );

    const data = await this.db
      .select({ ...BANNER_COLUMNS, shopName: shops.name })
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(where)
      .orderBy(desc(banners.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(where);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /**
   * Баннер продавца для модерации: сразу с названием магазина (уходит в ответ)
   * и владельцем (ему уходит уведомление о решении). Одним запросом, потому
   * что без владельца решение бессмысленно — продавец о нём не узнает.
   */
  findShopBannerById(id: number) {
    return this.db
      .select({
        ...BANNER_COLUMNS,
        shopName: shops.name,
        shopOwner: shops.owner,
      })
      .from(banners)
      .innerJoin(shops, eq(shops.id, banners.shopId))
      .where(eq(banners.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }

  create(data: NewBanner) {
    return this.db
      .insert(banners)
      .values(data)
      .returning(BANNER_COLUMNS)
      .then((r) => r[0]);
  }

  update(id: number, data: Partial<NewBanner>) {
    return this.db
      .update(banners)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(banners.id, id))
      .returning(BANNER_COLUMNS)
      .then((r) => r[0]);
  }

  delete(id: number) {
    return this.db.delete(banners).where(eq(banners.id, id));
  }

  /**
   * Максимальный порядок — чтобы новый баннер вставал в конец карусели.
   * Считается по площадочным: у баннеров продавцов `sort_order` не значит
   * ничего, и один их ноль не должен участвовать в вычислении конца списка,
   * которым распоряжается администратор.
   */
  async maxSortOrder(): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number | null>`max(${banners.sortOrder})` })
      .from(banners)
      .where(isNull(banners.shopId));
    return rows[0]?.max ?? -1;
  }

  /**
   * Расставляет переданные id по позициям 0..n-1 одним запросом: CASE в SET
   * вместо цикла из апдейтов, иначе перестановка десяти баннеров — это десять
   * поездок в базу, каждая из которых может не доехать.
   */
  async applyOrder(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    const cases = sql.join(
      ids.map((id, i) => sql`when ${banners.id} = ${id} then ${i}`),
      sql` `,
    );

    await this.db
      .update(banners)
      .set({
        sortOrder: sql`case ${cases} else ${banners.sortOrder} end`,
        updatedAt: new Date(),
      })
      .where(inArray(banners.id, ids));
  }
}
