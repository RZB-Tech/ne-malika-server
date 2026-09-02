import { BANNER_FORMAT } from './banners.constants';

/**
 * Сборка задания для генератора баннера.
 *
 * Задание пишется по-английски, а надписи, которые модель обязана нарисовать
 * дословно, идут в кавычках внутри английского текста — тот же приём, что и в
 * промптах карточек товара: генераторы изображений обучены на английских
 * описаниях, но кириллицу и латиницу переносят в картинку как есть.
 *
 * Модуль чистый — ни сети, ни зависимостей Nest: сборку промпта проверяет тест.
 */

/** Язык надписей на баннере. Их два: кириллица третьей копией не нужна. */
export const BANNER_LANGUAGES = ['ru', 'uz-Latn'] as const;
export type BannerLanguage = (typeof BANNER_LANGUAGES)[number];

export interface BannerShop {
  name: string;
  description?: string | null;
}

/** Товар, попадающий в баннер: чем он торгует, видно по названиям и разделам. */
export interface BannerProduct {
  name: string;
  categoryName?: string | null;
}

const LANGUAGE_RULES: Record<BannerLanguage, string> = {
  ru: 'All text on the banner must be in RUSSIAN, written in correct Cyrillic.',
  'uz-Latn':
    'All text on the banner must be in UZBEK, written in LATIN script ' +
    '(o‘zbek tili, lotin yozuvi). Never Russian, never Cyrillic letters.',
};

/**
 * Художественные решения. Без них все баннеры приезжают в одной сине-белой
 * гамме: и составитель промпта, и рисующая модель по умолчанию тянутся к
 * «технологичному синему», а компьютерная техника усиливает этот перекос.
 *
 * Решение выбирается по названию магазина: у одного магазина баннер держит
 * узнаваемый вид от перегенерации к перегенерации, а у разных магазинов на
 * витрине он разный.
 */
const DIRECTIONS = [
  'charcoal-to-black background with a warm amber glow behind the goods; ' +
    'headline block on the left, product cluster on the right',
  'graphite background with a magenta-to-violet neon rim and a faint tech ' +
    'grid; headline on the left, goods floating on the right',
  'bright studio background, soft grey-to-white gradient with long soft ' +
    'shadows; near-black heavy headline on the left',
  'deep emerald-to-teal gradient with a lime accent and a diagonal band ' +
    'behind the headline',
  'warm sand and cream background with a soft peach glow and a dark brown ' +
    'headline',
  'crimson-to-black background with a hot orange rim light and drifting ' +
    'smoke behind the goods',
  'icy white-to-pale-blue background with crisp geometric shapes and a navy ' +
    'headline',
  'matte purple-to-indigo background with a hard spotlight from above',
];

/**
 * Общие требования к картинке. Держатся отдельно от художественного решения:
 * решение меняется от магазина к магазину, а эти правила — никогда.
 */
const RULES = [
  `Wide horizontal marketplace hero banner, aspect ratio ${ratio()}, ` +
    'built to be read at a glance while scrolling.',
  /**
   * Про центральную треть — не украшательство: картинка приводится к формату
   * баннера обрезкой по центру, и текст у самого края её не переживёт.
   */
  'Keep the headline, the shop name and every word inside the central band ' +
    'of the frame, well away from all four edges: the outer edges get cropped.',
  'Photoreal goods composited on a designed background: glow and rim light ' +
    'behind them, realistic contact shadow. Never a bare white studio shot.',
  'Render every letter sharply and correctly — no invented glyphs, no ' +
    'misspellings, no gibberish text, no lorem ipsum.',
  'No prices, no phone numbers, no links, no QR codes, no marketplace logos, ' +
    'no watermarks, no borders.',
];

/**
 * Соотношение сторон десятичной дробью, а не «1942:809»: у баннера стороны
 * взаимно простые, и такая пара читается моделью как два размера, а не как
 * пропорция.
 */
function ratio(): string {
  const value = BANNER_FORMAT.width / BANNER_FORMAT.height;
  return `${value.toFixed(1)}:1`;
}

/** Устойчивый выбор решения по названию: тот же магазин — тот же вид. */
function directionFor(shopName: string): string {
  let hash = 0;
  for (const char of shopName) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return DIRECTIONS[Math.abs(hash) % DIRECTIONS.length];
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
 * Задание на первый баннер.
 *
 * Фотографии товаров уходят отдельно, референсами: сюда попадает только текст.
 * `hasPhotos` разводит два случая, которые модель иначе не различит, — товаров
 * у магазина нет вовсе и товары есть, но их снимки не приложены.
 */
export function buildBannerPrompt(input: {
  shop: BannerShop;
  products: BannerProduct[];
  language: BannerLanguage;
  hasPhotos: boolean;
  /** Пожелание продавца: «осенняя распродажа», «новинки Apple». */
  accent?: string;
}): string {
  const { shop, products, language, hasPhotos, accent } = input;

  const goods = assortment(products);
  const names = products.map((product) => product.name).filter(Boolean);

  return [
    'Design a wide promotional banner for an online shop on a computer-hardware marketplace.',
    '',
    `Shop name, render it verbatim as the brand line: "${shop.name}"`,
    goods.length > 0
      ? `The shop sells: ${goods.join(', ')}.`
      : 'The shop sells computer hardware and accessories.',
    names.length > 0 ? `Featured goods: ${names.join('; ')}.` : null,
    shop.description?.trim()
      ? `About the shop: ${shop.description.trim()}`
      : null,
    accent?.trim() ? `The banner is about: ${accent.trim()}` : null,
    '',
    hasPhotos
      ? 'The attached photos are the real goods of this shop: reproduce them ' +
        'faithfully — same models, shapes, colours and markings — and compose ' +
        'them into the banner. Do not invent different products.'
      : goods.length > 0
        ? 'No product photos are attached: draw typical goods of the ' +
          'categories named above, generic and unbranded.'
        : 'No product photos are attached: draw generic, unbranded computer ' +
          'hardware — a laptop, a keyboard, a mouse.',
    '',
    'Text on the banner, kept short enough to read while scrolling:',
    '- the shop name as a small brand line;',
    '- one bold headline of two or three words naming the benefit;',
    '- at most one short supporting line under it.',
    LANGUAGE_RULES[language],
    '',
    `Art direction: ${directionFor(shop.name)}.`,
    ...RULES,
  ]
    .filter((line) => line !== null)
    .join('\n');
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
