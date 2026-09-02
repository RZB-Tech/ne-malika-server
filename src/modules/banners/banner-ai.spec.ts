import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { BANNER_FORMAT } from './banners.constants';
import { toBannerFormat } from './banner-image';
import { buildBannerPrompt, buildTranslationPrompt } from './banner-prompt';

const SHOP = { name: 'ТехноМаркет', description: 'Ноутбуки с 2015 года' };

const PRODUCTS = [
  { name: 'MacBook Air M2', categoryName: 'Ноутбуки' },
  { name: 'Lenovo IdeaPad 3', categoryName: 'Ноутбуки' },
  { name: 'Мышь Logitech MX', categoryName: 'Мыши' },
];

function ru(overrides: Partial<Parameters<typeof buildBannerPrompt>[0]> = {}) {
  return buildBannerPrompt({
    shop: SHOP,
    products: PRODUCTS,
    language: 'ru',
    hasPhotos: true,
    ...overrides,
  });
}

describe('промпт баннера', () => {
  it('передаёт название магазина дословно — его модель рисует как есть', () => {
    assert.match(ru(), /"ТехноМаркет"/);
  });

  /**
   * Разделы каталога — это ответ на «чем торгует магазин». Три ноутбука подряд
   * не должны превращаться в «ноутбуки, ноутбуки, ноутбуки»: модель повторит
   * перечисление на самой картинке.
   */
  it('перечисляет разделы каталога без повторов', () => {
    const line = ru()
      .split('\n')
      .find((row) => row.startsWith('The shop sells:'));

    assert.equal(line, 'The shop sells: Ноутбуки, Мыши.');
  });

  it('называет сами товары — по ним модель понимает, что рисовать', () => {
    assert.match(ru(), /MacBook Air M2; Lenovo IdeaPad 3; Мышь Logitech MX/);
  });

  it('требует кириллицу для русского баннера', () => {
    assert.match(ru(), /RUSSIAN, written in correct Cyrillic/);
  });

  it('разводит «фото приложены» и «фотографий нет»', () => {
    assert.match(ru({ hasPhotos: true }), /attached photos are the real goods/);
    assert.match(ru({ hasPhotos: false }), /No product photos are attached/);
  });

  /**
   * Картинка приводится к формату баннера обрезкой по центру, поэтому текст у
   * края её не переживёт. Требование держать надписи в центре — не пожелание,
   * а условие того, что баннер вообще будет читаемым.
   */
  it('запрещает ставить текст к краям — их срежет обрезка', () => {
    assert.match(ru(), /central band of the frame/);
    assert.match(ru(), /outer edges get cropped/);
  });

  it('у магазина без товаров всё равно говорит, что рисовать', () => {
    const prompt = ru({ products: [], hasPhotos: false });

    assert.match(prompt, /The shop sells computer hardware and accessories\./);
    assert.doesNotMatch(prompt, /Featured goods/);
    // Ссылаться на «названные выше разделы» здесь нечем — их нет.
    assert.doesNotMatch(prompt, /categories named above/);
  });

  it('подхватывает пожелание продавца', () => {
    assert.match(ru({ accent: 'Осенняя распродажа' }), /Осенняя распродажа/);
  });

  /** Один магазин — один узнаваемый вид, сколько бы раз ни перегенерировали. */
  it('даёт одному магазину одно и то же художественное решение', () => {
    assert.equal(ru(), ru());
  });

  it('разным магазинам даёт разные решения', () => {
    const directionOf = (name: string) =>
      buildBannerPrompt({
        shop: { name },
        products: PRODUCTS,
        language: 'ru',
        hasPhotos: true,
      })
        .split('\n')
        .find((row) => row.startsWith('Art direction:'));

    const directions = new Set(
      ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Эпсилон', 'Дзета'].map(
        directionOf,
      ),
    );

    assert.ok(directions.size > 1, 'все магазины получили один и тот же вид');
  });
});

describe('промпт перевода баннера', () => {
  const prompt = buildTranslationPrompt({
    shop: SHOP,
    language: 'uz-Latn',
  });

  it('требует латиницу и прямо запрещает кириллицу', () => {
    assert.match(prompt, /LATIN script/);
    assert.match(prompt, /never Cyrillic letters/i);
  });

  it('оставляет название магазина непереведённым', () => {
    assert.match(prompt, /stays exactly as it is and is not translated: "ТехноМаркет"/);
  });

  /** Иначе на витрине у магазина оказались бы два разных баннера. */
  it('требует повторить вёрстку, а не нарисовать заново', () => {
    assert.match(prompt, /Reproduce it exactly, changing only the language/);
    assert.match(prompt, /Do not add, remove or move any element/);
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

  it('режет то, что модель вернула в своих пропорциях', async () => {
    const meta = await sharp(await toBannerFormat(await draw(1024, 1024)))
      .metadata()
      .then((m) => m);

    assert.equal(meta.width, BANNER_FORMAT.width);
    assert.equal(meta.height, BANNER_FORMAT.height);
  });

  it('доводит до точного размера и то, что уже нужных пропорций', async () => {
    const meta = await sharp(await toBannerFormat(await draw(1920, 800)))
      .metadata()
      .then((m) => m);

    assert.equal(meta.width, BANNER_FORMAT.width);
    assert.equal(meta.height, BANNER_FORMAT.height);
  });

  /** В S3 кладём jpeg: png такого размера весит втрое больше без выигрыша. */
  it('отдаёт jpeg', async () => {
    const meta = await sharp(await toBannerFormat(await draw(1920, 800)))
      .metadata()
      .then((m) => m);

    assert.equal(meta.format, 'jpeg');
  });
});
