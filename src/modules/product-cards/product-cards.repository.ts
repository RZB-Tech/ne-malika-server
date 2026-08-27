import { Inject, Injectable } from '@nestjs/common';
import {
  SQL,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/db.provider';
import { VISIBLE_PRODUCT } from '../../db/public-products';
import { resolvePage } from '../../common/dto/pagination-query.dto';
import {
  categories,
  NewProductCard,
  ProductCard,
  productCards,
  shops,
} from '../../db/schema';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';
import { FindAdminProductCardsQueryDto } from './dto/find-admin-product-cards-query.dto';
import { recomputeShopRating } from '../../db/rating';
import {
  buildProductSearch,
  escapeLike,
  type ProductSearch,
} from './product-search';
import {
  PAID_PLANS,
  PLAN_LIMITS,
} from '../subscriptions/subscriptions.constants';

/** Проекция товара для покупателя: без внутренних полей модерации и эмбеддинга. */
const PUBLIC_FIELDS = {
  id: productCards.id,
  shopId: productCards.shopId,
  name: productCards.name,
  description: productCards.description,
  photos: productCards.photos,
  price: productCards.price,
  state: productCards.state,
  createdAt: productCards.createdAt,
  shopName: shops.name,
  /** Оценка товара по опубликованным отзывам — звёзды на плитке каталога. */
  ratingAvg: productCards.ratingAvg,
  ratingCount: productCards.ratingCount,
  characteristics: productCards.characteristics,
  categoryId: productCards.categoryId,
  categorySlug: categories.slug,
  categoryNameRu: categories.nameRu,
  categoryNameUzLatn: categories.nameUzLatn,
  categoryNameUzCyrl: categories.nameUzCyrl,
};

/** То же плюс поля модерации: администратор должен видеть, почему товар скрыт. */
const ADMIN_FIELDS = {
  ...PUBLIC_FIELDS,
  status: productCards.status,
  abolishReason: productCards.abolishReason,
  abolishedAt: productCards.abolishedAt,
  updatedAt: productCards.updatedAt,
  shopStatus: shops.status,
};

const COUNT = { count: sql<number>`count(*)::int` };

/**
 * Текст, по которому ищут. Собирается прямо в запросе, а не хранится в столбце:
 * выражение целиком лежит в индексе, и Postgres пересчитывает его сам при
 * каждой записи. Предвычисленный столбец однажды уже разъехался с данными —
 * латиница в нём была, кириллица нет, и «МФУ» не находило «Струйное МФУ Canon».
 *
 * Точная копия выражения из `product_cards_search_idx`: планировщик сверяет
 * выражения, и любое расхождение (даже параметр вместо литерала) отправит
 * запрос в полный перебор таблицы.
 */
const SEARCH_DOCUMENT = sql`coalesce(${productCards.name}, '') || ' ' || coalesce(${productCards.description}, '')`;

/**
 * Два словаря на один текст. `russian` приводит слово к основе, поэтому
 * «ноутбуков» находит «ноутбук»; `simple` хранит слово как есть, и от этого
 * зависят узбекские и английские названия, которых русский словарь не знает.
 */
const SEARCH_VECTOR = sql`(to_tsvector('russian', ${SEARCH_DOCUMENT}) || to_tsvector('simple', ${SEARCH_DOCUMENT}))`;

/**
 * Витрина вперемешку. Тасуем не `random()`, а хэшем от пары «зерно + id»:
 * `random()` пересчитывается на каждый запрос, и вторая страница ленты
 * перемешалась бы заново — часть товаров показалась бы дважды, часть не
 * показалась бы вовсе. Хэш же при одном зерне даёт один и тот же порядок,
 * сколько бы страниц ни попросили, а меняется зерно — меняется вся витрина.
 *
 * Порядок этот индексом не поддержан и считается перебором активных карточек.
 * Их тысячи, а не миллионы, и запрос забирает только страницу — сортировка
 * укладывается в единицы миллисекунд. Появятся миллионы — понадобится не
 * индекс, а другой способ показывать случайное.
 *
 * id вторым ключом — на случай совпадения хэшей: без него порядок таких
 * товаров решала бы сама СУБД, и он мог бы разойтись между страницами.
 *
 * Продвижение подписчиков (`promo`) встраивается в ту же тасовку, а не рядом с
 * ней. Сила подписки — множитель вероятности оказаться выше, а не место в
 * списке: жёсткие ярусы («сначала все оплаченные, потом остальные») превратили
 * бы первую страницу в сплошной рекламный блок, и покупатель перестал бы
 * доверять порядку вовсе — включая позиции, за которые никто не платил.
 *
 * Формула — взвешенная выборка без возвращения (Efraimidis–Spirakis): ключ
 * `u^(1/w)`, где `u` — то же детерминированное число из [0,1] по паре «зерно +
 * id», а `w` — вес тарифа; берём наибольшие ключи. При `w = 1` возведение в
 * первую степень порядок не меняет, и магазин без подписки стоит ровно там же,
 * где стоял бы без всякого продвижения. При `w = 3` товар MAX попадает в начало
 * примерно втрое чаще — но не всегда, и место за ним не закреплено: одно и то
 * же зерно даёт один и тот же порядок, а новое зерно — новую расстановку.
 */
function randomOrder(seed: string, promo: Promo | null): SQL[] {
  /** Без продвижения — прежняя тасовка слово в слово: фильтрованные выдачи не меняются вовсе. */
  if (!promo) {
    return [
      sql`md5(${seed} || ${productCards.id}::text)`,
      asc(productCards.id),
    ];
  }

  /**
   * `shops` уже приджойнен ради `shops.name` и `shops.status` — вес достаётся
   * без нового соединения. Второй ключ по id остаётся по той же причине, что и
   * в тасовке без продвижения: при совпавших ключах порядок иначе выбирала бы
   * СУБД, и он мог бы разойтись между страницами одной ленты.
   */
  return [
    desc(sql`power(${shuffleKey(seed)}, 1.0 / ${promoWeightSql(promo.at)})`),
    asc(productCards.id),
  ];
}

/**
 * Момент, на который проверяется подписка в порядке выдачи. Округлён вниз до
 * пятиминутки намеренно.
 *
 * Живой `now()` менялся бы между запросами страниц одной ленты: у магазина,
 * чья подписка кончилась между первой и третьей страницей, вес упал бы с трёх
 * до единицы, его товары переехали бы вниз — и часть карточек показалась бы
 * покупателю дважды, а часть не показалась бы вовсе. Та же беда, из-за которой
 * витрина тасуется хэшем от зерна, а не `random()`: порядок обязан быть одним
 * и тем же для всех страниц одного захода.
 *
 * Отсюда обещание в обе стороны: истёкшая подписка перестаёт поднимать товар не
 * позже чем через PROMO_BUCKET_SEC, и ровно на столько же задерживается начало
 * оплаченного показа. Пять минут — сознательный размен: короче — и границу
 * корзины начнут пересекать обычные заходы с листанием, длиннее — и продавец
 * успеет пожаловаться, что оплата не сработала.
 */
export const PROMO_BUCKET_SEC = 300;

export function promoBucket(now: Date = new Date()): Date {
  const ms = PROMO_BUCKET_SEC * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/** Продвижение включено; `at` — момент, на который смотрим сроки подписок. */
interface Promo {
  at: Date;
}

/**
 * Тот же md5, что и в обычной тасовке, приведённый к числу из [0,1]: строку в
 * степень не возвести, а формуле нужен именно `u`.
 *
 * Семь hex-символов, а не восемь: `bit(28)::int` всегда неотрицателен, тогда
 * как `bit(32)` через `int4` умеет прийти со знаком — отрицательное `u` под
 * дробной степенью дало бы NaN и перевернуло бы весь порядок выдачи.
 */
function shuffleKey(seed: string): SQL {
  return sql`((('x' || substr(md5(${seed} || ${productCards.id}::text), 1, 7))::bit(28)::int)::double precision / 268435455.0)`;
}

/**
 * Вес магазина в общей витрине — SQL-половина `effectiveLimits`.
 *
 * **Это единственное место, где `shops.subscription_plan` читается напрямую**
 * (железное правило B4: колонка намеренно сохраняет `'max'` после истечения
 * срока, и всякая проверка вида `plan === 'max'` без второй половины выдала бы
 * права магазину, переставшему платить). Здесь обе половины условия стоят
 * рядом в каждой ветке `case`, а сравнение строгое — ровно как в
 * `SUBSCRIPTION_ACTIVE` и в `effectiveLimits`. Перебирать тысячи карточек в JS
 * ради веса нельзя, а SQL не умеет читать `subscriptions.constants.ts` — отсюда
 * второй экземпляр правила; встречный комментарий стоит в `PlanLimits.promoWeight`.
 *
 * Сами числа берутся из `PLAN_LIMITS`, а не объявляются здесь: разъехавшись,
 * два списка весов спорили бы молча — витрина показывала бы одно, а страница
 * тарифов обещала другое. Ветки с весом 1 в `case` не попадают: они ничем не
 * отличаются от `else`, и лишнее сравнение в выражении, которое считается на
 * каждой карточке, не нужно.
 */
function promoWeightSql(at: Date): SQL {
  const alive = gt(shops.subscriptionUntil, at);
  const branches = PAID_PLANS.filter(
    (plan) => PLAN_LIMITS[plan].promoWeight !== 1,
  ).map(
    (plan) =>
      sql`when ${alive} and ${eq(shops.subscriptionPlan, plan)} then ${PLAN_LIMITS[plan].promoWeight}::double precision`,
  );

  /** Все веса равны единице — продвижения нет; тогда и `case` строить не из чего. */
  if (branches.length === 0) return sql`1::double precision`;

  return sql`(case ${sql.join(branches, sql` `)} else 1::double precision end)`;
}

/**
 * Общая витрина — выдача, которую покупатель ничем не сузил.
 *
 * Проверяем все параметры разом, а не одно «нет поиска»: любой фильтр означает
 * осознанный запрос, и подменять ответ на него оплаченным — не реклама, а
 * подлог. Решение владельца: поиск и категории не трогаем вовсе.
 *
 * Смотрим на `categoryIds`, а не на `query.category_id`/`query.category`: ветку
 * каталога разворачивает сервис, и после разворота фильтр виден только здесь.
 * `ids` сравниваем с `undefined`, а не с длиной: пустой массив — «просили
 * список, список оказался мусорным», и выдача обязана быть пустой.
 *
 * `visitor_id`, `seed`, `page` и `limit` фильтрами не являются и здесь не
 * упомянуты сознательно: они меняют порядок и объём страницы, а не состав
 * выдачи.
 */
function isGeneralCatalog(
  query: FindProductCardsQueryDto,
  categoryIds?: number[],
): boolean {
  return (
    !query.q &&
    categoryIds === undefined &&
    query.ids === undefined &&
    query.shop_id === undefined &&
    query.price_min === undefined &&
    query.price_max === undefined &&
    !query.state
  );
}

/**
 * Порядок выдачи. При поиске сортировка по новизне бессмысленна: сверху обязан
 * оказаться товар, у которого совпало название, а не тот, что заведён вчера и
 * упомянут в описании вскользь.
 */
function resolveSort(
  query: FindProductCardsQueryDto,
  search: ProductSearch | null,
  promo: Promo | null,
): SQL[] {
  if (query.sort === 'random') {
    return randomOrder(query.seed ?? '', promo);
  }
  if (query.sort === 'price_asc') {
    return [sql`${productCards.price} asc nulls last`];
  }
  if (query.sort === 'price_desc') {
    return [sql`${productCards.price} desc nulls last`];
  }

  if (!search) return [desc(productCards.createdAt)];

  return [
    desc(
      sql`ts_rank(to_tsvector('russian', coalesce(${productCards.name}, '')), to_tsquery('russian', ${search.queries[0]}), 1)`,
    ),
    desc(productCards.createdAt),
  ];
}

@Injectable()
export class ProductCardsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  create(data: NewProductCard): Promise<ProductCard> {
    return this.db
      .insert(productCards)
      .values(data)
      .returning()
      .then((r) => r[0]);
  }

  findById(id: number): Promise<ProductCard | undefined> {
    return this.db.query.productCards.findFirst({
      where: eq(productCards.id, id),
    });
  }

  /** Список товаров конкретного магазина в кабинете продавца — включая упразднённые. */
  findByShopId(shopId: number): Promise<ProductCard[]> {
    return this.db
      .select()
      .from(productCards)
      .where(eq(productCards.shopId, shopId))
      .orderBy(desc(productCards.createdAt));
  }

  /** Проверка владения товаром через цепочку product_card → shop → owner. */
  findByIdAndOwner(id: number, ownerId: number) {
    return this.db
      .select({ card: productCards })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(eq(productCards.id, id), eq(shops.owner, ownerId)))
      .then((r) => r[0]?.card);
  }

  /** Публичная карточка товара: сам товар и его магазин должны быть активны. */
  findPublicById(id: number) {
    return this.db
      .select(PUBLIC_FIELDS)
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .leftJoin(categories, eq(productCards.categoryId, categories.id))
      .where(and(eq(productCards.id, id), ...publicConditions()))
      .then((r) => r[0]);
  }

  /**
   * `categoryIds` — уже развёрнутая ветка каталога: разворачивает её сервис,
   * потому что рекурсивный обход дерева живёт в репозитории категорий.
   */
  async findPublicList(
    query: FindProductCardsQueryDto,
    categoryIds?: number[],
  ) {
    const { page, limit, offset } = resolvePage(query);
    /** Разбираем запрос один раз: он нужен и условию выборки, и порядку. */
    const search = query.q ? buildProductSearch(query.q) : null;
    const where = and(...publicConditions(query, categoryIds, search));

    /**
     * Продвижение — только на нетронутой витрине и только вперемешку. Обе
     * половины условия обязательны: в отсортированной по цене выдаче поднимать
     * подписчика значило бы врать про цену, а в отфильтрованной — подменять
     * ответ на осознанный запрос покупателя.
     */
    const promo =
      query.sort === 'random' && isGeneralCatalog(query, categoryIds)
        ? { at: promoBucket() }
        : null;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(PUBLIC_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .leftJoin(categories, eq(productCards.categoryId, categories.id))
        .where(where)
        .orderBy(...resolveSort(query, search, promo))
        .limit(limit)
        .offset(offset),
      this.db
        .select(COUNT)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /**
   * Магазины, чьи товары попали в выдачу по этому запросу, — для счётчика
   * поисковых запросов.
   *
   * Отдельный запрос, а не разбор уже отданной страницы. Страница — двадцать
   * четыре карточки, и магазин, чей товар стоит на тридцатой позиции, не увидел
   * бы этот запрос в своём отчёте вовсе, хотя по нему его находят: покупатель
   * листает дальше, а вторая страница в статистику не идёт (иначе самым
   * популярным запросом площадки оказался бы тот, по которому кто-то один
   * долистал до конца).
   *
   * `WHERE` тот же самый, что у выдачи, — собирается тем же `publicConditions`.
   * Расхождение здесь означало бы отчёт про выдачу, которой покупатель не
   * видел.
   *
   * `LIMIT` без `ORDER BY` — обрезка неупорядоченная, и это осознанно: чем один
   * магазин из тысячи совпавших достойнее другого, сказать нечего, а
   * упорядочивание потребовало бы отсортировать всю тысячу ради выбрасывания
   * восьмисот. Смысл ограничения — потолок на число строк вставки от одного
   * нажатия клавиши.
   *
   * Джойн с `categories` не нужен: он в выдаче только ради названий раздела в
   * проекции, а условия к нему не обращаются — фильтр по ветке каталога
   * приходит готовым списком id.
   */
  async findMatchingShopIds(
    query: FindProductCardsQueryDto,
    categoryIds: number[] | undefined,
    limit: number,
  ): Promise<number[]> {
    const search = query.q ? buildProductSearch(query.q) : null;

    const rows = await this.db
      .selectDistinct({ shopId: productCards.shopId })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(...publicConditions(query, categoryIds, search)))
      .limit(limit);

    return rows.map((row) => row.shopId);
  }

  /**
   * Выдача администратора: все статусы, включая упразднённые и скрытые ИИ.
   * Поиск здесь по ILIKE, а не по search_vector: индекс полнотекстового поиска
   * строится только по активным полям карточки, а искать нужно и среди скрытых.
   */
  async findAllForAdmin(query: FindAdminProductCardsQueryDto) {
    const { page, limit, offset } = resolvePage(query);

    const conditions: SQL[] = [];
    if (query.status) {
      conditions.push(eq(productCards.status, query.status));
    }
    if (query.shop_id) {
      conditions.push(eq(productCards.shopId, query.shop_id));
    }
    if (query.q) {
      /** Экранируем: «%» и «_» из строки поиска — это ввод, а не шаблон LIKE. */
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(
        or(ilike(productCards.name, pattern), ilike(shops.name, pattern))!,
      );
    }
    if (query.uncategorized) {
      conditions.push(isNull(productCards.categoryId));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, totalRows] = await Promise.all([
      this.db
        .select(ADMIN_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .leftJoin(categories, eq(productCards.categoryId, categories.id))
        .where(where)
        .orderBy(desc(productCards.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select(COUNT)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .where(where),
    ]);

    return { data, total: totalRows[0]?.count ?? 0, page, limit };
  }

  /** Только id и дата — для sitemap, без тяжёлых полей и без пагинации по кругу. */
  findPublicIds(): Promise<{ id: number; updatedAt: Date }[]> {
    return this.db
      .select({ id: productCards.id, updatedAt: productCards.updatedAt })
      .from(productCards)
      .innerJoin(shops, eq(productCards.shopId, shops.id))
      .where(and(...publicConditions()))
      .orderBy(desc(productCards.updatedAt));
  }

  update(id: number, data: Partial<NewProductCard>): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }

  /**
   * Вместе с товаром каскадом уходят и отзывы о нём, поэтому оценку продавца
   * приходится пересобрать здесь: в модуле отзывов об этом удалении никто не
   * узнает, и «4,7 · 12 отзывов» осталось бы висеть от несуществующих.
   */
  async delete(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(productCards)
        .where(eq(productCards.id, id))
        .returning({ shopId: productCards.shopId });

      if (deleted) await recomputeShopRating(tx, deleted.shopId);
    });
  }

  abolish(id: number, reason: string): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({
        status: 'abolished',
        abolishReason: reason,
        abolishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }

  restore(id: number): Promise<ProductCard> {
    return this.db
      .update(productCards)
      .set({
        status: 'active',
        abolishReason: null,
        abolishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(productCards.id, id))
      .returning()
      .then((r) => r[0]);
  }
}

/**
 * Условия публичной выдачи. Активность товара и магазина — обязательная часть:
 * без неё упразднённые администратором карточки продолжали бы висеть в каталоге.
 */
function publicConditions(
  query: FindProductCardsQueryDto = {},
  categoryIds?: number[],
  search: ProductSearch | null = null,
): SQL[] {
  const conditions: SQL[] = [...VISIBLE_PRODUCT];

  if (categoryIds) {
    conditions.push(
      categoryIds.length > 0
        ? inArray(productCards.categoryId, categoryIds)
        : sql`false`,
    );
  }

  if (query.ids) {
    conditions.push(
      query.ids.length > 0 ? inArray(productCards.id, query.ids) : sql`false`,
    );
  }
  if (query.q) {
    conditions.push(search ? searchCondition(search) : sql`false`);
  }
  if (query.price_min !== undefined) {
    conditions.push(gte(productCards.price, query.price_min.toString()));
  }
  if (query.price_max !== undefined) {
    conditions.push(lte(productCards.price, query.price_max.toString()));
  }
  if (query.state) {
    conditions.push(eq(productCards.state, query.state));
  }
  if (query.shop_id) {
    conditions.push(eq(productCards.shopId, query.shop_id));
  }

  return conditions;
}

/**
 * Совпадение по товару. Веток несколько, и объединены они через OR намеренно:
 * каждая ловит свой промах предыдущей.
 *
 * - полнотекстовые ветки — по слову с начала, включая вариант запроса в другой
 *   письменности («printer» → «принтер»);
 * - подстрока в названии — по хвосту артикула: «4470» полнотекстовым поиском
 *   не найдётся, потому что это не начало слова «G4470»;
 * - подстрока в названии магазина — покупатели ищут и по продавцу.
 */
function searchCondition(search: ProductSearch): SQL {
  const branches: SQL[] = search.queries.map(
    (query) => sql`${SEARCH_VECTOR} @@ to_tsquery('russian', ${query})`,
  );

  if (search.like) {
    branches.push(ilike(productCards.name, search.like));
    branches.push(ilike(shops.name, search.like));
  }

  return or(...branches)!;
}
