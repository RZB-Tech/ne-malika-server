import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { OPENAI_IMAGE_CLIENT } from './openai-image.provider';
import { FilesService } from '../files/files.service';
import {
  GenerateImagesDto,
  GeneratedImageDto,
  MAX_GENERATED_IMAGES,
} from './dto/generate-images.dto';

type ImageEditSize = NonNullable<OpenAI.Images.ImageEditParams['size']>;

/** Картинки идут дольше текста, а их может быть до четырёх за запрос. */
const IMAGE_TIMEOUT_MS = 180_000;
const PROMPT_TIMEOUT_MS = 60_000;

const PROMPT_SYSTEM = `Ты пишешь промпт для генератора изображений по фотографии товара с маркетплейса компьютерной техники.

Ответ — только сам промпт обычным текстом. Без JSON, без кавычек вокруг,
без заголовков и пояснений вроде «Вот промпт:».

В промпте по-русски опиши: что это за товар (тип, узнаваемая модель, цвет, материал),
как он должен быть снят (ракурс, свет, фон, кадрирование) и что важно сохранить.
Пиши так, чтобы получилась чистая студийная карточка для маркетплейса:
однородный светлый фон, мягкий свет, товар целиком, без людей, без текста и логотипов
магазинов, без коллажей и водяных знаков.

Не выдумывай характеристики, которых не видно на фото. Если модель не опознаётся —
опиши то, что видно, общими словами.`;

@Injectable()
export class ImageGenService {
  private readonly logger = new Logger(ImageGenService.name);

  constructor(
    @Inject(OPENAI_IMAGE_CLIENT) private readonly openai: OpenAI | null,
    private readonly files: FilesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Промпт по фотографии — кнопка «сгенерировать промпт» в админке. Раньше это
   * делал Groq, но там суточная квота общая с ИИ-проверкой товаров: пара
   * нажатий съедала лимит, и проверка оставалась без токенов. Теперь работает
   * дешёвая модель OpenAI — рисование всё равно идёт туда же.
   */
  async describePrompt(photoKey: string): Promise<{ prompt: string }> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY не задан — промпт можно написать вручную',
      );
    }

    const model = this.config.get<string>('openaiImages.visionModel')!;
    try {
      const completion = await this.openai.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: PROMPT_SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Опиши товар с этой фотографии.' },
                {
                  type: 'image_url',
                  image_url: { url: await this.files.toDataUrl(photoKey) },
                },
              ],
            },
          ],
        },
        { timeout: PROMPT_TIMEOUT_MS, maxRetries: 1 },
      );

      const prompt = cleanPrompt(completion.choices[0]?.message?.content);
      if (!prompt) {
        throw new Error('модель вернула пустой промпт');
      }
      return { prompt };
    } catch (err) {
      const details = describeError(err);
      this.logger.error(
        `Промпт по фото ${photoKey} не составлен (модель ${model}): ${details}`,
      );

      // Ответ провайдера сам объясняет, в какой лимит упёрлись — его и
      // показываем, иначе админ будет жать кнопку впустую.
      const status = (err as { status?: number }).status;
      throw new BadGatewayException(
        status === 429
          ? `Лимит запросов исчерпан. ${details}`
          : `Не удалось составить промпт: ${details}`,
      );
    }
  }

  /**
   * Перерисовывает фотографию товара. Исходник уходит в модель как основа,
   * поэтому на выходе тот же товар, а не похожий: для карточки это принципиально.
   */
  async generate(dto: GenerateImagesDto): Promise<GeneratedImageDto[]> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY не задан — генерация фотографий отключена',
      );
    }

    const count = Math.min(dto.count ?? 2, MAX_GENERATED_IMAGES);
    const model = this.config.get<string>('openaiImages.model')!;

    // Референс идёт вторым кадром: модель принимает несколько картинок и
    // ориентируется на них вместе.
    const sources = [
      dto.photoKey,
      ...(dto.referenceKey ? [dto.referenceKey] : []),
    ];
    // Чтение из S3 отделено от вызова модели: обе стадии отвечают 502, и без
    // разных текстов админ не поймёт, чинить хранилище или ключ OpenAI.
    let images: Awaited<ReturnType<typeof toFile>>[];
    try {
      images = await Promise.all(
        sources.map(async (key, i) =>
          toFile(await this.download(key), `source-${i}.png`, {
            type: 'image/png',
          }),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Исходное фото ${dto.photoKey} не прочитано: ${message}`,
      );
      throw new BadGatewayException(
        `Не удалось прочитать исходное фото из хранилища: ${message}`,
      );
    }

    const attempts = await Promise.allSettled(
      Array.from({ length: count }, () => this.requestOne(model, images, dto)),
    );

    const saved: GeneratedImageDto[] = [];
    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled') saved.push(...attempt.value);
    }

    if (saved.length === 0) {
      const reason = attempts.find((a) => a.status === 'rejected');
      const details =
        reason?.status === 'rejected'
          ? describeError(reason.reason)
          : 'модель не вернула ни одной картинки';

      this.logger.error(
        `Генерация по фото ${dto.photoKey} упала (модель ${model}, ` +
          `${images.length} файл(ов), ${sizeKb(images)} КБ): ${details}`,
      );
      throw new BadGatewayException(`Модель не отработала: ${details}`);
    }

    const failed = attempts.length - saved.length;
    this.logger.log(
      `Сгенерировано ${saved.length} из ${count} фото по ключу ${dto.photoKey}` +
        (failed > 0 ? ` (${failed} попыток не удалось)` : ''),
    );
    return saved;
  }

  /** Один вариант за запрос: короткое соединение живёт до ответа, длинное рвут. */
  private async requestOne(
    model: string,
    images: Awaited<ReturnType<typeof toFile>>[],
    dto: GenerateImagesDto,
  ): Promise<GeneratedImageDto[]> {
    const result = await this.openai!.images.edit(
      {
        model,
        image: images.length === 1 ? images[0] : images,
        prompt: dto.prompt,
        n: 1,
        // Размеры вроде 2048x2048 и 2880x2880 принимает gpt-image-2, но в
        // типах SDK перечислены только старые — union там отстаёт от API.
        size: (dto.size ?? '1024x1024') as ImageEditSize,
        quality: dto.quality ?? 'medium',
      },
      { timeout: IMAGE_TIMEOUT_MS, maxRetries: 2 },
    );

    const saved: GeneratedImageDto[] = [];
    for (const item of result.data ?? []) {
      if (!item.b64_json) continue;
      const key = await this.files.saveBuffer(
        Buffer.from(item.b64_json, 'base64'),
        'image/png',
      );
      saved.push({ key, url: this.files.buildPublicUrl(key) });
    }
    return saved;
  }

  /** Исходник лежит в нашем S3 — тянем его байтами, а не ссылкой: приватный бакет модель не откроет. */
  private async download(key: string): Promise<Buffer> {
    const file = await this.files.getFile(key);
    const chunks: Buffer[] = [];
    for await (const chunk of file.body) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Разбор ошибки SDK. Отдельно вытаскиваем cause: при обрыве связи наружу летит
 * общее «Connection error.», а настоящая причина (ECONNRESET, таймаут заголовков,
 * сброс TLS) лежит только там — без неё чинить нечего.
 */
function describeError(err: unknown): string {
  const e = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  return [
    e.status ? `HTTP ${e.status}` : null,
    e.code,
    e.message ?? String(err),
    e.cause
      ? `причина: ${e.cause.code ?? ''} ${e.cause.message ?? ''}`.trim()
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Вес отправляемого в модель тела — первый подозреваемый при обрыве связи. */
function sizeKb(files: { size?: number }[]): number {
  return Math.round(files.reduce((sum, f) => sum + (f.size ?? 0), 0) / 1024);
}

/**
 * Модель просили ответить голым текстом, но она может обернуть его в кавычки
 * или блок кода — снимаем обёртку, чтобы админ не правил это руками.
 */
function cleanPrompt(raw: string | null | undefined): string {
  let text = (raw ?? '').trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '');
  text = text.replace(/^["«»']+/, '').replace(/["«»']+$/, '');
  return text.trim();
}
