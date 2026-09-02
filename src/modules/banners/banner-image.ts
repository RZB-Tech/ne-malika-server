import sharp from 'sharp';
import { BANNER_FORMAT } from './banners.constants';

/**
 * Приведение картинки от модели к формату баннера.
 *
 * Генератор изображений отдаёт свой размер: у него набор поддерживаемых
 * пропорций, и просить ровно 1942×809 бессмысленно — придёт что-то близкое.
 * Карусель же рисует баннер в одну строго заданную рамку, и картинка другого
 * соотношения либо растянется, либо оставит поля по краям.
 *
 * `cover` от центра, а не `contain` с полями: баннер во всю ширину экрана с
 * чёрными полосами выглядит поломкой, а срезанные поля — нет. Промпт поэтому
 * требует держать текст в центральной трети: именно она переживает обрезку при
 * любом соотношении, которое вернёт модель.
 */
const JPEG_QUALITY = 90;

export async function toBannerFormat(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize(BANNER_FORMAT.width, BANNER_FORMAT.height, {
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}
