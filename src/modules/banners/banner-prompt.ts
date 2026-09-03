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
  address?: string | null;
  telegramLink?: string | null;
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
export const BANNER_BRIEF_SYSTEM = `You are a world-class commercial art director designing an ultra-clean, high-converting promotional hero banner for an online computer & electronics store on the NeMalika marketplace (Tashkent, Malika market).

The banner MUST strictly follow this commercial advertising layout:
1. Overall aesthetic:
- Wide horizontal banner, clean, modern, high-key commercial studio aesthetic.
- Light bright background: crisp white to soft light-blue / silver gradient with subtle elegant curved geometric lines. Bright, clean, professional ambient studio lighting.
- Top-right corner: small neat marketplace branding badge reading verbatim: "NEMALIKA Проверенные магазины".

2. Right side — Multi-product showcase ensemble:
- An attractive commercial 3D arrangement / ensemble of MULTIPLE real products sold by the shop (4 to 6 items: e.g. laptop, bag/sleeve, mouse, keyboard, projector, accessories, gadgets).
- Arranged cleanly on a polished light reflective desk surface with realistic soft contact shadows and crisp material textures.
- NEVER draw just a single product. It MUST be a cohesive ensemble of several distinct products representing the shop's catalog.

3. Left side — Marketing & trust column:
- Top shop badge: pill-shaped tag with the shop's market location / identifier: e.g. "[A14] на Malika" or "[ShopName] на Malika".
- Big bold headline: 2-3 words in large, bold sans-serif Cyrillic typography (e.g. "ТЕХНОЛОГИИ ДЛЯ ТЕБЯ", "ВСЁ ДЛЯ ИГР И РАБОТЫ", "МИР НОУТБУКОВ И ПК").
- 3 to 4 category feature pills with minimal line icons and short 2-line labels matching what the store sells (e.g. "Периферия / для игр и работы", "Проекторы / для дома и офиса", "Чехлы / для MacBook", "Сумки / для ноутбуков").
- Trust badges row: 4 minimalist icons with labels: "Гарантия качества", "Проверенные бренды", "Быстрая доставка", "Поддержка 24/7".
- Call to action: vibrant blue rounded button with a Telegram paper plane icon: "Подпишись на магазин [ShopName] и будь в курсе новинок и скидок!".

Return strictly JSON and nothing else:
{"prompt":"...","title":"..."}

prompt — detailed image generator prompt in English (80-160 words), specifying the clean light multi-product composition, exact layout, lighting, and quoting all Russian text verbatim in double quotes.
title — short Russian title for the banner for admin list, up to ${BANNER_TITLE_MAX} characters. Not a slogan: it must say which shop and which banner this is.

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
  const location = shop.address?.trim()
    ? `Павильон/адрес: ${shop.address.trim()}`
    : null;

  return [
    `Магазин: ${shop.name}`,
    location,
    shop.description?.trim() ? `О себе: ${shop.description.trim()}` : null,
    goods.length > 0
      ? `Разделы каталога: ${goods.join(', ')}`
      : 'Разделы каталога: не указаны',
    products.length > 0
      ? `Товары: ${products.map((product) => product.name).join('; ')}`
      : 'Товаров в каталоге пока нет',
    hasPhotos
      ? 'Ниже приложены фотографии этих товаров — на баннере должны быть именно они в виде красивой общей композиции.'
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
    'Clean, bright commercial high-key studio aesthetic: white and soft light-blue ambient lighting, polished light reflective surface with realistic soft contact shadows.',
    'Multi-product showcase on the right side: compose multiple distinct products together into a cohesive commercial lineup.',
    'Structured marketing column on the left with shop badge, bold headline, category highlights, trust badges row, and Telegram CTA button.',
    LANGUAGE_RULES[language],
    'Render every letter sharply and correctly — no invented glyphs, no ' +
      'misspellings, no gibberish text, no lorem ipsum.',
    'No prices, no phone numbers, no links, no QR codes, no watermarks, no borders.',
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
  const shopTag = shop.address?.trim()
    ? `[${shop.address.trim()}] на Malika`
    : `[${shop.name}] на Malika`;

  const prompt = [
    'Ultra-clean modern horizontal commercial hero banner for an electronics marketplace store.',
    'Bright high-key studio lighting, soft white-to-light-blue gradient background with smooth subtle curved tech waves.',
    'Top right corner branding badge: "NEMALIKA Проверенные магазины".',
    'Left side structured marketing column:',
    `- Store badge pill: "${shopTag}", shop: "${shop.name}"`,
    '- Large bold two-line Cyrillic headline: "ТЕХНОЛОГИИ ДЛЯ ТЕБЯ"',
    goods.length > 0
      ? `The shop sells: ${goods.join(', ')}.`
      : 'The shop sells computer hardware and accessories.',
    '- Trust badges row: "Гарантия качества", "Проверенные бренды", "Быстрая доставка", "Поддержка 24/7"',
    `- Blue rounded Telegram CTA button: "Подпишись на магазин ${shop.name} и будь в курсе новинок и скидок!"`,
    'Right side multi-product showcase ensemble:',
    hasPhotos
      ? 'A photorealistic commercial arrangement of multiple actual products from the shop on a polished light reflective surface with soft shadows.'
      : 'Draw generic, unbranded computer hardware — a laptop, a keyboard, a mouse.',
    products.length > 0
      ? `Featured goods: ${products.map((product) => product.name).join('; ')}.`
      : null,
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
    'Translate the wording faithfully and keep it about the same length, so that it fits the same blocks.',
    '- Trust badges translate to Uzbek Latin: "Sifat kafolati", "Ishonchli brendlar", "Tezkor yetkazib berish", "24/7 qo‘llab-quvvatlash".',
    `- Telegram CTA button translates to: "${shop.name} do‘koniga obuna bo‘ling va yangiliklardan xabardor bo‘ling!".`,
    `The shop name stays exactly as it is and is not translated: "${shop.name}"`,
    '',
    'Render every letter sharply and correctly — no invented glyphs, no ' +
      'misspellings, no gibberish text.',
    `Wide horizontal banner, aspect ratio ${ratio()}, text kept inside the ` +
      'central band away from the edges.',
  ].join('\n');
}
