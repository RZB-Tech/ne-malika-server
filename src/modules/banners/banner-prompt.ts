import { BANNER_FORMAT } from './banners.constants';

/**
 * Задание для генератора баннера.
 *
 * Творческую часть пишет не этот модуль, а модель: она смотрит на магазин —
 * название, разделы каталога, товары и их фотографии — и придумывает, что и как
 * нарисовать. Собранный вручную шаблон этого не умел: у продавца ноутбуков и у
 * мастерской по ремонту получался один и тот же баннер с подставленным именем.
 *
 * За кодом остаётся то, чему модель доверять нельзя: формат, язык надписей и
 * запреты. Эти правила дописываются к любому придуманному тексту — иначе
 * очередной удачный промпт однажды приезжал бы с ценой на картинке или с
 * текстом, который срежет обрезка.
 *
 * Модуль чистый — ни сети, ни зависимостей Nest: сборку проверяет тест.
 */

/** Язык надписей на баннере. Их два: кириллица третьей копией не нужна. */
export const BANNER_LANGUAGES = ['ru', 'uz-Latn'] as const;
export type BannerLanguage = (typeof BANNER_LANGUAGES)[number];

export interface BannerShop {
  name: string;
  description?: string | null;
}

/** Товар, попадающий в баннер: чем магазин торгует, видно по нему. */
export interface BannerProduct {
  name: string;
  categoryName?: string | null;
}

/** Что придумала модель, разобрав магазин. */
export interface BannerBrief {
  /** Творческая часть задания — по-английски, как её просили написать. */
  prompt: string;
  /** Название баннера для админки и alt изображения — по-русски. */
  title: string;
}

/** Столько влезает в `banners.title`; модели говорим тот же предел. */
export const BANNER_TITLE_MAX = 200;

const LANGUAGE_RULES: Record<BannerLanguage, string> = {
  ru: 'All text on the banner must be in RUSSIAN, written in correct Cyrillic.',
  'uz-Latn':
    'All text on the banner must be in UZBEK, written in LATIN script ' +
    '(o‘zbek tili, lotin yozuvi). Never Russian, never Cyrillic letters.',
};

/**
 * Задание тому, кто разбирает магазин и пишет промпт.
 *
 * Просим именно промпт, а не картинку словами: дальше текст уходит рисующей
 * модели, и она понимает английские описания сцены куда лучше, чем пересказ
 * на русском. Русским остаётся только то, что попадёт на саму картинку.
 */
export const BANNER_BRIEF_SYSTEM = `You are an art director for a computer-hardware marketplace. You are given a shop: its name, what it sells, a few of its goods and their photos. Work out what this shop is about and write a prompt for an image generator that will draw a wide promotional banner for it.

Return strictly JSON and nothing else:
{"prompt":"...","title":"..."}

prompt — the image prompt, in English, 60-120 words. Describe:
- which goods to show and how they are arranged;
- the background, palette and lighting, chosen to fit this particular shop rather than a generic tech look;
- where the text blocks sit.

Quote verbatim, in double quotes, every word that must appear on the banner: the shop name and a short headline of two or three words. Write those quoted words in Russian. Invent the headline from what the shop actually sells — no empty "лучшие цены" when nothing in the data says so.

Judge the shop by its data, not by wishful thinking:
- a shop with two products is a small shop; do not draw a hypermarket;
- a repair or setup service is not a goods shop: show the work, a workbench, a master at the desk — not a boxed product;
- if the goods are all from one category, build the banner around that category.

title — a short Russian name for this banner for the admin list, up to ${BANNER_TITLE_MAX} characters. Not a slogan: it must say which shop and which banner this is.

Never put prices, phone numbers, links or promises of discounts into either field: the shop did not promise them.`;

/**
 * Что модель узнаёт о магазине. По-русски и списком: это данные, а не задание,
 * и разбирать их модели проще в том же виде, в каком они лежат у нас.
 */
export function buildShopBrief(input: {
  shop: BannerShop;
  products: BannerProduct[];
  hasPhotos: boolean;
}): string {
  const { shop, products, hasPhotos } = input;
  const goods = assortment(products);

  return [
    `Магазин: ${shop.name}`,
    shop.description?.trim() ? `О себе: ${shop.description.trim()}` : null,
    goods.length > 0
      ? `Разделы каталога: ${goods.join(', ')}`
      : 'Разделы каталога: не указаны',
    products.length > 0
      ? `Товары: ${products.map((product) => product.name).join('; ')}`
      : 'Товаров в каталоге пока нет',
    hasPhotos
      ? 'Ниже приложены фотографии этих товаров — на баннере должны быть именно они.'
      : 'Фотографий товаров нет: опиши типовые товары этих разделов, без выдуманных брендов.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Правила, которые дописываются к придуманному моделью тексту.
 *
 * Держатся здесь, а не в задании художнику: их нарушение стоит нам баннера, и
 * зависеть от того, вспомнит ли о них модель в этот раз, они не должны.
 */
function rules(language: BannerLanguage): string[] {
  return [
    `Wide horizontal marketplace hero banner, aspect ratio ${ratio()}, ` +
      'built to be read at a glance while scrolling.',
    /**
     * Про центральную полосу — не украшательство: картинка приводится к формату
     * баннера обрезкой по центру, и текст у самого края её не переживёт.
     */
    'Keep the headline, the shop name and every word inside the central band ' +
      'of the frame, well away from all four edges: the outer edges get cropped.',
    'Photoreal goods composited on a designed background: glow and rim light ' +
      'behind them, realistic contact shadow. Never a bare white studio shot.',
    LANGUAGE_RULES[language],
    'Render every letter sharply and correctly — no invented glyphs, no ' +
      'misspellings, no gibberish text, no lorem ipsum.',
    'No prices, no phone numbers, no links, no QR codes, no marketplace logos, ' +
      'no watermarks, no borders.',
  ];
}

/**
 * Соотношение сторон десятичной дробью, а не «1942:809»: у баннера стороны
 * взаимно простые, и такая пара читается моделью как два размера, а не как
 * пропорция.
 */
function ratio(): string {
  return `${(BANNER_FORMAT.width / BANNER_FORMAT.height).toFixed(1)}:1`;
}

/** Готовое задание рисующей модели: замысел плюс наши правила. */
export function composeBannerPrompt(
  creative: string,
  language: BannerLanguage,
): string {
  return [creative.trim(), '', ...rules(language)].join('\n');
}

/**
 * Чем торгует магазин — списком разделов каталога, а не догадкой по названию.
 * Повторы схлопываются: три ноутбука в подборке не должны превращаться в
 * «ноутбуки, ноутбуки, ноутбуки».
 */
function assortment(products: BannerProduct[]): string[] {
  const seen = new Set<string>();
  for (const product of products) {
    const category = product.categoryName?.trim();
    if (category) seen.add(category);
  }
  return [...seen];
}

/**
 * Замысел на случай, когда разобрать магазин не удалось.
 *
 * Модель-художник дешёвая и иногда не отвечает — 429, обрыв, мусор вместо
 * JSON. Ронять из-за этого генерацию не за что: баннер по названию и разделам
 * выйдет безликим, но рабочим, а продавец увидит картинку, а не ошибку.
 */
export function fallbackBrief(input: {
  shop: BannerShop;
  products: BannerProduct[];
  hasPhotos: boolean;
}): BannerBrief {
  const { shop, products, hasPhotos } = input;
  const goods = assortment(products);

  const prompt = [
    'Design a wide promotional banner for an online shop on a computer-hardware marketplace.',
    `Show the shop name as a small brand line: "${shop.name}"`,
    goods.length > 0
      ? `The shop sells: ${goods.join(', ')}.`
      : 'The shop sells computer hardware and accessories.',
    products.length > 0
      ? `Featured goods: ${products.map((product) => product.name).join('; ')}.`
      : null,
    hasPhotos
      ? 'The attached photos are the real goods of this shop: reproduce them ' +
        'faithfully and compose them into the banner.'
      : 'Draw generic, unbranded computer hardware — a laptop, a keyboard, a mouse.',
    'Goods on the right, a bold two-word Russian headline on the left over a ' +
      'dark background with a warm glow behind the goods.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return {
    prompt,
    title: `Баннер магазина «${shop.name}»`.slice(0, BANNER_TITLE_MAX),
  };
}

/**
 * Разбор ответа художника. Форме не доверяем: пустой или битый ответ — повод
 * взять запасной замысел, а не отдать продавцу картинку по мусорному заданию.
 */
export function parseBannerBrief(
  raw: string | null | undefined,
): BannerBrief | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw ?? '') as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const prompt = text(parsed.prompt);
  if (!prompt) return null;

  return {
    prompt,
    title: text(parsed.title).slice(0, BANNER_TITLE_MAX),
  };
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Задание на перевод уже одобренного баннера.
 *
 * Второй язык рисуется не заново, а поверх принятой картинки: продавец уже
 * согласился с вёрсткой и товарами, и «ещё один баннер про то же самое» здесь
 * не годится — на витрине это должен быть тот же баннер, только с другими
 * надписями. Поэтому оригинал уходит единственным референсом, а задание сведено
 * к замене текста.
 */
export function buildTranslationPrompt(input: {
  shop: BannerShop;
  language: BannerLanguage;
}): string {
  const { shop, language } = input;

  return [
    'The attached image is a finished banner. Reproduce it exactly, changing ' +
      'only the language of the text on it.',
    '',
    'Keep identical: layout, composition, background, colours, lighting, the ' +
      'goods and their placement, the position and size of every text block.',
    'Do not add, remove or move any element. Do not redraw the goods.',
    '',
    LANGUAGE_RULES[language],
    'Translate the wording faithfully and keep it about the same length, so ' +
      'that it fits the same blocks.',
    `The shop name stays exactly as it is and is not translated: "${shop.name}"`,
    '',
    'Render every letter sharply and correctly — no invented glyphs, no ' +
      'misspellings, no gibberish text.',
    `Wide horizontal banner, aspect ratio ${ratio()}, text kept inside the ` +
      'central band away from the edges.',
  ].join('\n');
}
