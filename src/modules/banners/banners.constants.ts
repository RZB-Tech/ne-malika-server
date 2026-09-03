import { moderationStatusEnum } from '../../db/schema';

const BANNER_FORMATS = [
  { width: 1942, height: 809 },
  { width: 1240, height: 400 },
] as const;

/**
 * Основной формат: по нему карусель считает высоту слота, к нему же
 * приводится всё, что рисует ИИ.
 */
export const BANNER_FORMAT = BANNER_FORMATS[0];

export const BANNER_FORMATS_LABEL = BANNER_FORMATS.map(
  (f) => `${f.width}×${f.height}`,
).join(' / ');

export const MAX_ACTIVE_BANNERS = 10;

export const SHOP_BANNER_SLOTS = 4;

export const SHOP_BANNER_ROTATION_SEC = 300;

export function bucketKey(now: Date = new Date()): string {
  const windowMs = SHOP_BANNER_ROTATION_SEC * 1000;
  return String(Math.floor(now.getTime() / windowMs));
}

export const BANNER_MODERATION_STATUSES = moderationStatusEnum.enumValues;
export type BannerModerationStatus =
  (typeof BANNER_MODERATION_STATUSES)[number];

export const BANNER_MODERATION_DECISIONS = [
  'approved',
  'rejected',
] as const satisfies readonly BannerModerationStatus[];
export type BannerModerationDecision =
  (typeof BANNER_MODERATION_DECISIONS)[number];

/**
 * Размер, который просим у модели.
 *
 * Ровно 1942×809 у генератора не спросишь: он рисует в своей сетке размеров.
 * Просим то же соотношение 2.4:1 круглыми числами, а результат всё равно
 * приводим к формату баннера обрезкой — тогда неточность модели стоит нам
 * полей по краям, а не растянутой картинки на витрине.
 */
export const BANNER_GEN_SIZE = '1920x800';

/**
 * Качество генерации. `high` при таком размере вчетверо дороже, а баннер
 * смотрят с расстояния ленты — разницы там не видно, в отличие от счёта.
 */
export const BANNER_GEN_QUALITY = 'medium';

/**
 * Сколько товаров показать модели. Больше трёх она начинает раскладывать их
 * мелкой сеткой, и баннер перестаёт читаться на бегу; меньше двух — витрина
 * выглядит пустой.
 */
export const BANNER_SOURCE_PRODUCTS = 6;

/**
 * Куда ведёт клик по баннеру магазина.
 *
 * Подставляется само: продавцу незачем набирать адрес собственной страницы
 * руками, а опечатка в нём уводила бы покупателя в никуда с оплаченного места
 * на главной. Путь от корня, а не абсолютный адрес: витрина живёт на своём
 * домене и на своей же странице магазина, каким бы он ни был.
 */
export function shopBannerLink(shopId: number): string {
  return `/store/${shopId}`;
}
