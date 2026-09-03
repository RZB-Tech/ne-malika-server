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

CRITICAL REQUIREMENT: CREATIVE DIVERSITY & ANTI-REPETITION.
Every banner must be visually distinct, accurate, and free of repetitive text.

Always follow this commercial advertising framework:

1. Right side — Multi-product showcase ensemble (4 to 6 items):
- An attractive commercial 3D arrangement / ensemble of MULTIPLE real products sold by the shop (e.g. laptop, bag/sleeve, mouse, keyboard, projector, accessories, gadgets).
- Vary the composition style for each generation! For example:
  * Floating multi-tier geometric or frosted glass pedestals/podiums
  * Dynamic angled 3D knolling or flat-lay with depth
  * Sleek executive desk showcase with flagship center and flanking accessories
  * Dynamic diagonal sweeping curve or pyramid lineup with realistic contact shadows
- NEVER draw just a single product. It MUST be an ensemble of several distinct products from the shop.

2. Overall aesthetic, atmosphere & color palette (vary boldly!):
- High-key, clean, modern commercial studio lighting with smooth reflections.
- Choose a distinctive, memorable color atmosphere tailored to the shop and the creative direction:
  * Glacier frost: pure white with icy cyan and electric blue reflections
  * Titanium & slate: brushed platinum, light graphite, sleek modern executive
  * Cyberpunk-clean: bright studio with vibrant neon cyan and violet edge glow
  * Warm studio luxury: soft champagne reflections, sunbeam light streaks
  * Emerald high-tech: refreshing mint and deep jade tech accents
  * Sunset tech: soft gradient light leaks of coral and lavender
- Top-right corner: neat branding badge reading verbatim: "NEMALIKA Проверенные магазины".

3. Left side — Marketing & trust column:
- Top shop badge: pill-shaped tag with the EXACT store identifier given in the shop data (e.g. "[ShopName] на Malika").
  * STRICT RULE: NEVER invent random pavilion letters or numbers (NEVER write "A14" or other store codes unless explicitly given in the shop data!).
- Bold headline (2-3 words in large, bold sans-serif Cyrillic typography):
  * INVENT A FRESH, PUNCHY, UNIQUE RUSSIAN HEADLINE suited to what the store sells. Never repeat the same slogan!
  * E.g. for gaming: "МОЩЬ ДЛЯ ИГР", "ТВОЙ ПУТЬ К ПОБЕДЕ", "ИГРОВОЙ АРСЕНАЛ", "ПРОКАЧАЙ СЕЙВ"
  * E.g. for laptops/work: "ИНСТРУМЕНТЫ УСПЕХА", "СТИЛЬ И МОЩНОСТЬ", "ДЛЯ БОЛЬШИХ ДЕЛ", "РАБОТАЙ НА МАКСИМУМЕ"
  * E.g. for accessories/peripherals: "КОМФОРТ В ДЕТАЛЯХ", "ИДЕАЛЬНЫЙ СЕТАП", "ТОЧНОСТЬ И СТИЛЬ"
  * E.g. for audio/video: "КИНОТЕАТР ДОМА", "НОВЫЙ ВЗГЛЯД", "ЧИСТЫЙ ЗВУК И ЦВЕТ"
  * E.g. for general tech: "ТЕХНОЛОГИИ БУДУЩЕГО", "ВЫБИРАЙ ЛУЧШЕЕ", "ТВОЙ УМНЫЙ ВЫБОР", "ТЕХНОЛОГИИ ДЛЯ ТЕБЯ"
- Exactly 4 category/feature pills:
  * STRICT ANTI-REPETITION: You MUST use 4 completely DIFFERENT categories/features (use the 4 distinct pills provided in the shop data).
  * STRICTLY FORBIDDEN to repeat any category name or description! NEVER write "Периферия" or any single category across multiple pills! Every pill must have its own distinct title and subtitle.
- Trust badges row: 4 minimalist icons with labels: "Гарантия качества", "Проверенные бренды", "Быстрая доставка", "Поддержка 24/7".
- Call to action: vibrant blue rounded button with a Telegram paper plane icon: "Подпишись на магазин [ShopName] и будь в курсе новинок и скидок!".

Return strictly JSON and nothing else:
{"prompt":"...","title":"..."}

prompt — detailed image generator prompt in English (80-160 words), specifying the unique color palette, composition layout, lighting, goods arrangement, and quoting all Russian text verbatim in double quotes.
title — short Russian title for the banner for admin list, up to ${BANNER_TITLE_MAX} characters.

Never put prices, phone numbers, links or promises of discounts into either field: the shop did not promise them.`;

/**
 * Что модель узнаёт о магазине. По-русски и списком: это данные, а не задание,
 * и разбирать их модели проще в том же виде, в каком они лежат у нас.
 */
const CREATIVE_DIRECTIONS = [
  'Светлая ледяная студия: кристально белый фон, ледяные лазурные и неоново-синие отражения, парящие матовые стеклянные подиумы.',
  'Титан и графит: премиальный технологичный стиль, матовые металлические акценты, мягкий естественный студийный свет из окна.',
  'Кибер-чистый стиль: яркая студия с неоновыми бирюзовыми и мягкими фиолетовыми контурными бликами на товарах.',
  'Изумруд и мята: свежие мятно-зеленые градиентные акценты, легкие геометрические призмы, технологичная чистота.',
  'Теплый люксовый студийный свет: мягкие золотистые и янтарные блики, естественные контактные тени, ощущение эксклюзивности.',
  'Сапфир и глянец: белоснежная основа, глубокие сапфировые плавные линии фона, ступенчатая пирамидальная расстановка товаров.',
];

const HEADLINE_MOODS = [
  'Заголовок в стиле максимальной производительности, скорости и успеха в работе.',
  'Заголовок в стиле побед, мощности и бескомпромиссного игрового процесса.',
  'Заголовок в стиле умного стиля жизни, инноваций и комфорта в каждой детали.',
  'Заголовок в стиле премиального качества, проверенной надежности и идеального выбора.',
];

export interface CategoryPill {
  title: string;
  subtitle: string;
}

const PRODUCT_KEYWORD_MAP: Array<{
  regex: RegExp;
  title: string;
  subtitle: string;
}> = [
  {
    regex:
      /ноутбук|laptop|macbook|ultrabook|ideapad|thinkpad|zenbook|vivobook|victus|tuf|rog|aspire|nitro/i,
    title: 'Ноутбуки',
    subtitle: 'для работы и игр',
  },
  {
    regex: /наушник|гарнитур|headset|headphone|airpods|earbuds/i,
    title: 'Аудио',
    subtitle: 'чистый объёмный звук',
  },
  {
    regex: /мышь|мышка|mouse/i,
    title: 'Мыши',
    subtitle: 'точность и скорость',
  },
  {
    regex: /клавиатур|keyboard/i,
    title: 'Клавиатуры',
    subtitle: 'быстрый отклик',
  },
  {
    regex: /рюкзак|сумка|чехол|backpack|case|sleeve/i,
    title: 'Рюкзаки и чехлы',
    subtitle: 'защита и комфорт',
  },
  {
    regex: /монитор|экран|дисплей|monitor|display/i,
    title: 'Мониторы',
    subtitle: 'чёткое изображение',
  },
  {
    regex: /проектор|projector/i,
    title: 'Проекторы',
    subtitle: 'для дома и офиса',
  },
  {
    regex: /компьютер|системн|пк|desktop|pc/i,
    title: 'Компьютеры',
    subtitle: 'максимальная мощь',
  },
  {
    regex: /видеокарт|gpu|rtx|gtx|radeon/i,
    title: 'Видеокарты',
    subtitle: 'графика нового уровня',
  },
  {
    regex: /накопител|ssd|hdd|диск|памят|ram/i,
    title: 'Накопители и память',
    subtitle: 'мгновенная скорость',
  },
  {
    regex: /коврик|mousepad/i,
    title: 'Коврики и аксессуары',
    subtitle: 'идеальное скольжение',
  },
];

const DEFAULT_FEATURE_PILLS: CategoryPill[] = [
  { title: 'Оригинальная техника', subtitle: '100% гарантия качества' },
  { title: 'Широкий выбор', subtitle: 'всегда в наличии' },
  { title: 'Актуальные новинки', subtitle: 'свежие поступления' },
  { title: 'Выгодные предложения', subtitle: 'лучшие цены' },
  { title: 'Премиум сервис', subtitle: 'помощь с выбором' },
  { title: 'Быстрая доставка', subtitle: 'прямо до двери' },
];

export function resolveStoreBadge(shop: BannerShop): string {
  const addr = shop.address?.trim();
  if (addr) {
    const pavilionMatch = addr.match(
      /^(?:павильон\s*|ряд\s*|магазин\s*|бокс\s*)?([A-Za-zА-Яа-яЁё]?\s*[-–]?\s*\d+[A-Za-zА-Яа-яЁё]?)$/i,
    );
    if (pavilionMatch && pavilionMatch[1]) {
      return `[${pavilionMatch[1].replace(/\s+/g, '')}] на Malika`;
    }
  }
  return `[${shop.name}] на Malika`;
}

export function resolveCategoryPills(
  products: BannerProduct[],
): CategoryPill[] {
  const result: CategoryPill[] = [];
  const usedTitles = new Set<string>();

  // 1. Из категорий товаров
  for (const product of products) {
    const cat = product.categoryName?.trim();
    if (cat && !usedTitles.has(cat.toLowerCase())) {
      const lower = cat.toLowerCase();
      const subtitle = lower.includes('ноут')
        ? 'для работы и игр'
        : lower.includes('мышь') || lower.includes('мыши')
          ? 'точность и комфорт'
          : lower.includes('клав')
            ? 'быстрый отклик'
            : lower.includes('периф')
              ? 'для удобной работы'
              : 'надёжные решения';
      result.push({ title: cat, subtitle });
      usedTitles.add(cat.toLowerCase());
      if (result.length >= 4) break;
    }
  }

  // 2. Из названий товаров по ключевым словам
  for (const product of products) {
    if (result.length >= 4) break;
    const name = product.name;
    for (const kw of PRODUCT_KEYWORD_MAP) {
      if (kw.regex.test(name) && !usedTitles.has(kw.title.toLowerCase())) {
        result.push({ title: kw.title, subtitle: kw.subtitle });
        usedTitles.add(kw.title.toLowerCase());
        if (result.length >= 4) break;
      }
    }
  }

  // 3. Дополняем преимуществами магазина, исключая повторы
  for (const pill of DEFAULT_FEATURE_PILLS) {
    if (result.length >= 4) break;
    if (!usedTitles.has(pill.title.toLowerCase())) {
      result.push(pill);
      usedTitles.add(pill.title.toLowerCase());
    }
  }

  return result.slice(0, 4);
}

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
  const badge = resolveStoreBadge(shop);
  const pills = resolveCategoryPills(products);

  const direction =
    CREATIVE_DIRECTIONS[Math.floor(Math.random() * CREATIVE_DIRECTIONS.length)];
  const mood =
    HEADLINE_MOODS[Math.floor(Math.random() * HEADLINE_MOODS.length)];
  const seed = Math.floor(Math.random() * 1000000);

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
    `Плашка магазина в верхнем углу (писать СТРОГО этот текст): "${badge}"`,
    'Плашки категорий (писать строго эти 4 разные плашки, НЕ повторять слова!):',
    ...pills.map((p, i) => `  Плашка ${i + 1}: "${p.title}" / "${p.subtitle}"`),
    `Творческий стиль этой генерации: ${direction}`,
    `Акцент слогана: ${mood}`,
    `Сид разнообразия: #${seed}. Сделай эту вариацию неповторимой по цветам, композиции и заголовку.`,
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
    'Clean, bright commercial high-key studio aesthetic with distinct, high-quality lighting and polished reflective surfaces.',
    'Multi-product showcase on the right side: compose multiple distinct products together into a cohesive commercial lineup.',
    'Structured marketing column on the left with shop badge, bold headline, category highlights, trust badges row, and Telegram CTA button.',
    'STRICT ANTI-REPETITION: Every pill and text element must be distinct. Strictly forbidden to repeat any category name or description across multiple pills (never repeat words like "Периферия"!). Never invent pavilion codes like "A14" unless provided.',
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
const FALLBACK_HEADLINES = [
  'ТЕХНОЛОГИИ ДЛЯ ТЕБЯ',
  'ИНСТРУМЕНТЫ УСПЕХА',
  'ВСЁ ДЛЯ ИДЕАЛЬНОГО СЕТАПА',
  'МОЩЬ И СТИЛЬ',
  'ТВОЙ УМНЫЙ ВЫБОР',
  'ВЫБИРАЙ ЛУЧШЕЕ',
];

const FALLBACK_STYLES = [
  'Bright high-key studio lighting, soft white-to-light-blue gradient background with smooth subtle curved tech waves.',
  'High-key modern studio lighting with frosted glass podiums, icy cyan ambient reflections, and soft smooth ribbons.',
  'Pristine commercial studio with brushed titanium surfaces, soft natural daylight, and minimalist geometric shapes.',
  'Clean bright aesthetic with subtle neon cyan rim lighting on products and smooth floating translucent panels.',
  'Warm high-tech studio environment with soft champagne reflections and natural contact shadows.',
];

const FALLBACK_STAGINGS = [
  'A photorealistic commercial arrangement of multiple actual products on floating frosted glass pedestals with realistic shadows.',
  'A dynamic 3D knolling ensemble of the products angled towards the camera on a polished reflective surface.',
  'A multi-tier executive desk arrangement of the products with crisp textures and soft ambient contact shadows.',
  'A cohesive showcase lineup of diverse goods with one flagship item center-stage and accessories dynamically arranged.',
];

export function fallbackBrief(input: {
  shop: BannerShop;
  products: BannerProduct[];
  hasPhotos: boolean;
}): BannerBrief {
  const { shop, products, hasPhotos } = input;
  const goods = assortment(products);
  const badge = resolveStoreBadge(shop);
  const pills = resolveCategoryPills(products);

  const headline =
    FALLBACK_HEADLINES[Math.floor(Math.random() * FALLBACK_HEADLINES.length)];
  const style =
    FALLBACK_STYLES[Math.floor(Math.random() * FALLBACK_STYLES.length)];
  const staging =
    FALLBACK_STAGINGS[Math.floor(Math.random() * FALLBACK_STAGINGS.length)];

  const prompt = [
    'Ultra-clean modern horizontal commercial hero banner for an electronics marketplace store.',
    style,
    'Top right corner branding badge: "NEMALIKA Проверенные магазины".',
    'Left side structured marketing column:',
    `- Store badge pill: "${badge}", shop: "${shop.name}"`,
    `- Large bold two-line Cyrillic headline: "${headline}"`,
    goods.length > 0
      ? `The shop sells: ${goods.join(', ')}.`
      : 'The shop sells computer hardware and accessories.',
    '- 4 distinct category feature pills with icons (never repeating words):',
    ...pills.map((p) => `  * "${p.title}" / "${p.subtitle}"`),
    '- Trust badges row: "Гарантия качества", "Проверенные бренды", "Быстрая доставка", "Поддержка 24/7"',
    `- Blue rounded Telegram CTA button: "Подпишись на магазин ${shop.name} и будь в курсе новинок и скидок!"`,
    'Right side multi-product showcase ensemble:',
    hasPhotos
      ? staging
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
