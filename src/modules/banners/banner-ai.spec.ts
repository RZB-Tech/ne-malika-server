import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { BANNER_FORMAT, shopBannerLink } from './banners.constants';
import { toBannerFormat } from './banner-image';
import {
  BANNER_TITLE_MAX,
  buildShopBrief,
  buildTranslationPrompt,
  composeBannerPrompt,
  fallbackBrief,
  parseBannerBrief,
} from './banner-prompt';

const SHOP = { name: 'ТехноМаркет', description: 'Ноутбуки с 2015 года' };

const PRODUCTS = [
  { name: 'MacBook Air M2', categoryName: 'Ноутбуки' },
  { name: 'Lenovo IdeaPad 3', categoryName: 'Ноутбуки' },
  { name: 'Мышь Logitech MX', categoryName: 'Мыши' },
];

describe('досье магазина для разбора моделью', () => {
  const brief = buildShopBrief({
    shop: SHOP,
    products: PRODUCTS,
    hasPhotos: true,
  });

  it('называет магазин и то, что он о себе написал', () => {
    assert.match(brief, /Магазин: ТехноМаркет/);
    assert.match(brief, /О себе: Ноутбуки с 2015 года/);
  });

  /**
   * Разделы каталога — это ответ на «чем торгует магазин». Три ноутбука подряд
   * не должны превращаться в «ноутбуки, ноутбуки, ноутбуки».
   */
  it('перечисляет разделы каталога без повторов', () => {
    assert.match(brief, /Разделы каталога: Ноутбуки, Мыши$/m);
  });

  it('перечисляет сами товары', () => {
    assert.match(brief, /MacBook Air M2; Lenovo IdeaPad 3; Мышь Logitech MX/);
  });

  it('разводит «фото приложены» и «фотографий нет»', () => {
    assert.match(brief, /приложены фотографии/);
    assert.match(
      buildShopBrief({ shop: SHOP, products: PRODUCTS, hasPhotos: false }),
      /Фотографий товаров нет/,
    );
  });

  it('у магазина без товаров говорит об этом прямо, а не молчит', () => {
    const empty = buildShopBrief({
      shop: { name: 'Новый' },
      products: [],
      hasPhotos: false,
    });

    assert.match(empty, /Товаров в каталоге пока нет/);
    assert.match(empty, /Разделы каталога: не указаны/);
  });
});

describe('разбор ответа модели', () => {
  it('берёт замысел и название', () => {
    const brief = parseBannerBrief(
      JSON.stringify({ prompt: 'Laptops on a dark background', title: 'Баннер' }),
    );

    assert.deepEqual(brief, {
      prompt: 'Laptops on a dark background',
      title: 'Баннер',
    });
  });

  it('обрезает слишком длинное название под колонку', () => {
    const brief = parseBannerBrief(
      JSON.stringify({ prompt: 'x', title: 'я'.repeat(BANNER_TITLE_MAX + 50) }),
    );

    assert.equal(brief?.title.length, BANNER_TITLE_MAX);
  });

  /** Пустой замысел рисовать нечем — вызывающий возьмёт запасной. */
  it('отвергает ответ без замысла', () => {
    assert.equal(parseBannerBrief(JSON.stringify({ title: 'Баннер' })), null);
    assert.equal(parseBannerBrief('не json'), null);
    assert.equal(parseBannerBrief(null), null);
  });
});

describe('запасной замысел', () => {
  const brief = fallbackBrief({
    shop: SHOP,
    products: PRODUCTS,
    hasPhotos: true,
  });

  it('всё равно называет магазин и его товары', () => {
    assert.match(brief.prompt, /"ТехноМаркет"/);
    assert.match(brief.prompt, /The shop sells: Ноутбуки, Мыши\./);
  });

  it('даёт название, которое влезает в колонку', () => {
    assert.ok(brief.title.length > 0);
    assert.ok(brief.title.length <= BANNER_TITLE_MAX);
  });

  it('у магазина без товаров не ссылается на несуществующие разделы', () => {
    const empty = fallbackBrief({
      shop: { name: 'Новый' },
      products: [],
      hasPhotos: false,
    });

    assert.match(empty.prompt, /generic, unbranded computer hardware/);
    assert.doesNotMatch(empty.prompt, /Featured goods/);
  });
});

describe('сборка задания рисующей модели', () => {
  const prompt = composeBannerPrompt('Laptops on a dark background', 'ru');

  it('сохраняет замысел модели целиком', () => {
    assert.match(prompt, /^Laptops on a dark background/);
  });

  /**
   * Правила дописываются кодом, а не остаются на совести модели: их нарушение
   * стоит нам баннера, и зависеть от того, вспомнит ли она о них, нельзя.
   */
  it('требует кириллицу для русского и латиницу для узбекского', () => {
    assert.match(prompt, /RUSSIAN, written in correct Cyrillic/);
    assert.match(
      composeBannerPrompt('x', 'uz-Latn'),
      /UZBEK, written in LATIN script/,
    );
  });

  it('запрещает ставить текст к краям — их срежет обрезка', () => {
    assert.match(prompt, /central band of the frame/);
    assert.match(prompt, /outer edges get cropped/);
  });

  it('запрещает цены и контакты, что бы ни придумала модель', () => {
    assert.match(prompt, /No prices, no phone numbers/);
  });

  it('называет пропорцию понятной дробью, а не парой сторон', () => {
    assert.match(prompt, /aspect ratio 2\.4:1/);
  });
});

describe('промпт перевода баннера', () => {
  const prompt = buildTranslationPrompt({ shop: SHOP, language: 'uz-Latn' });

  it('требует латиницу и прямо запрещает кириллицу', () => {
    assert.match(prompt, /LATIN script/);
    assert.match(prompt, /never Cyrillic letters/i);
  });

  it('оставляет название магазина непереведённым', () => {
    assert.match(prompt, /is not translated: "ТехноМаркет"/);
  });

  /** Иначе на витрине у магазина оказались бы два разных баннера. */
  it('требует повторить вёрстку, а не нарисовать заново', () => {
    assert.match(prompt, /Reproduce it exactly, changing only the language/);
    assert.match(prompt, /Do not add, remove or move any element/);
  });
});

describe('ссылка баннера магазина', () => {
  it('ведёт на страницу самого магазина', () => {
    assert.equal(shopBannerLink(12), '/store/12');
  });
});

describe('приведение картинки к формату баннера', () => {
  async function draw(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 10, g: 90, b: 200 },
      },
    })
      .png()
      .toBuffer();
  }

  const sizeOf = async (image: Buffer) => {
    const meta = await sharp(await toBannerFormat(image)).metadata();
    return { width: meta.width, height: meta.height, format: meta.format };
  };

  it('режет то, что модель вернула в своих пропорциях', async () => {
    const meta = await sizeOf(await draw(1024, 1024));

    assert.equal(meta.width, BANNER_FORMAT.width);
    assert.equal(meta.height, BANNER_FORMAT.height);
  });

  it('доводит до точного размера и то, что уже нужных пропорций', async () => {
    const meta = await sizeOf(await draw(1920, 800));

    assert.equal(meta.width, BANNER_FORMAT.width);
    assert.equal(meta.height, BANNER_FORMAT.height);
  });

  /** В S3 кладём jpeg: png такого размера весит втрое больше без выигрыша. */
  it('отдаёт jpeg', async () => {
    assert.equal((await sizeOf(await draw(1920, 800))).format, 'jpeg');
  });
});
