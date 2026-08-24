import { Inject, Injectable } from '@nestjs/common';
import {
  SQL,
  and,
  asc,
  desc,
  eq,
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
 */
function randomOrder(seed: string): SQL[] {
  return [sql`md5(${seed} || ${productCards.id}::text)`, asc(productCards.id)];
}

/**
 * Порядок выдачи. При поиске сортировка по новизне бессмысленна: сверху обязан
 * оказаться товар, у которого совпало название, а не тот, что заведён вчера и
 * упомянут в описании вскользь.
 */
function resolveSort(
  query: FindProductCardsQueryDto,
  search: ProductSearch | null,
): SQL[] {
  if (query.sort === 'random') {
    return randomOrder(query.seed ?? '');
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

    const [data, totalRows] = await Promise.all([
      this.db
        .select(PUBLIC_FIELDS)
        .from(productCards)
        .innerJoin(shops, eq(productCards.shopId, shops.id))
        .leftJoin(categories, eq(productCards.categoryId, categories.id))
        .where(where)
        .orderBy(...resolveSort(query, search))
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
