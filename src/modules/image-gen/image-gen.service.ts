import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { OPENROUTER_CLIENT } from '../openrouter/openrouter-client.provider';
import { FilesService } from '../files/files.service';
import {
  GenerateImagesDto,
  GeneratedImageDto,
  MAX_GENERATED_IMAGES,
} from './dto/generate-images.dto';

/** Образец для правки: Images API принимает и ссылку, и data-URL. */
interface ImageReference {
  type: 'image_url';
  image_url: { url: string };
}

/** Ответ /images: картинки приходят байтами в base64, а не ссылками. */
interface OpenRouterImagesResponse {
  data?: { b64_json?: string; media_type?: string }[];
}

/** Картинки идут дольше текста, а их может быть до четырёх за запрос. */
const IMAGE_TIMEOUT_MS = 180_000;
const PROMPT_TIMEOUT_MS = 60_000;

/**
 * Промпт пишем по-английски: генераторы изображений обучены на английских
 * описаниях и понимают их точнее, чем перевод. Требование краткости здесь не
 * про стиль — длинный ответ модель печатает дольше, а ждёт его живой человек.
 */
const PROMPT_SYSTEM = `You write prompts for an image generator. The result must look like a marketplace product listing photo (like Amazon or Ozon), not an advertisement or a lifestyle scene.

Reply with the prompt itself only: plain English text, no JSON, no quotes around it, no preamble like "Here is the prompt:".

Describe the product itself — type, recognizable model, colour, material — and then the shot: product centred and filling most of the frame, three-quarter or front view, pure white seamless background, soft even studio light, subtle contact shadow under the product.

Critical: the bare product only. Never a box, never retail packaging, never a product sitting in or next to a package. No hands, no people, no props, no furniture, no room, no text, no captions, no labels added, no brand logos of stores, no collage, no watermark, no borders.

Do not invent specs you cannot see in the photo. If the model is unrecognizable, describe what is visible in general terms.

Keep it under 60 words.`;

/**
 * Хвост, который приклеивается к любому промпту при генерации. Промпт пишет
 * человек и может забыть про формат, а модель по умолчанию любит показать товар
 * в коробке и в интерьере — для карточки маркетплейса это брак.
 */
const CARD_STYLE = [
  'Marketplace product listing photo.',
  'The bare product only — no box, no packaging, no props, no people, no room.',
  'Centred, filling most of the frame, pure white seamless background,',
  'soft even studio lighting, subtle contact shadow.',
  'No added text, captions, labels, watermarks or borders.',
].join(' ');

@Injectable()
export class ImageGenService {
  private readonly logger = new Logger(ImageGenService.name);

  constructor(
    @Inject(OPENROUTER_CLIENT) private readonly router: OpenAI | null,
    private readonly files: FilesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Промпт по фотографии — кнопка «составить промпт» в админке. Смотрит фото
   * модель из OpenRouter: она дешевле рисующей, а работа тут простая. Рисование
   * остаётся у OpenAI — только там есть размер, качество и количество за запрос.
   */
  async describePrompt(photoKey: string): Promise<{ prompt: string }> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — промпт можно написать вручную',
      );
    }

    const model = this.config.get<string>('openrouter.visionModel')!;
    try {
      const completion = await this.router.chat.completions.create(
        {
          model,
          max_completion_tokens: 1000,
          messages: [
            { role: 'system', content: PROMPT_SYSTEM },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Write the image prompt for this product photo.',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: await this.files.toDataUrl(photoKey),
                    detail: 'low',
                  },
                },
              ],
            },
          ],
        },
        { timeout: PROMPT_TIMEOUT_MS, maxRetries: 1 },
      );

      const choice = completion.choices[0];
      const prompt = cleanPrompt(choice?.message?.content);
      if (!prompt) {
        throw new Error(
          `модель вернула пустой промпт (finish_reason: ${choice?.finish_reason ?? '—'}, ` +
            `токенов: ${completion.usage?.completion_tokens ?? '—'})`,
        );
      }
      return { prompt };
    } catch (err) {
      const details = describeError(err);
      this.logger.error(
        `Промпт по фото ${photoKey} не составлен (модель ${model}): ${details}`,
      );

      const status = (err as { status?: number }).status;
      throw new BadGatewayException(
        status === 429
          ? `Лимит запросов исчерпан. ${details}`
          : `Не удалось составить промпт: ${details}`,
      );
    }
  }

  /**
   * Перерисовывает фотографию товара. Исходник уходит модели как образец,
   * поэтому на выходе тот же товар, а не похожий: для карточки это принципиально.
   */
  async generate(dto: GenerateImagesDto): Promise<GeneratedImageDto[]> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — генерация фотографий отключена',
      );
    }

    const count = Math.min(dto.count ?? 2, MAX_GENERATED_IMAGES);
    const model = this.config.get<string>('openrouter.imageModel')!;

    // Образцы отдаём байтами: Images API принимает и ссылку, но тогда за
    // картинкой ходил бы провайдер, и наш недоступный CDN снова ломал бы всё.
    const keys = [
      dto.photoKey,
      ...(dto.referenceKey ? [dto.referenceKey] : []),
    ];
    let references: ImageReference[];
    try {
      references = await Promise.all(
        keys.map(async (key) => ({
          type: 'image_url' as const,
          image_url: { url: await this.files.toDataUrl(key) },
        })),
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

    // Каждый вариант — отдельный короткий запрос вместо одного длинного с n=N:
    // долгие соединения рвут по простою, а короткие успевают. Побочно это даёт
    // частичный успех — три картинки из четырёх лучше, чем ошибка на всю пачку.
    const attempts = await Promise.allSettled(
      Array.from({ length: count }, () =>
        this.requestOne(model, references, dto),
      ),
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
        `Генерация по фото ${dto.photoKey} упала (модель ${model}): ${details}`,
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

  /**
   * Один вариант за запрос. Идёт не в chat/completions, а в отдельный
   * /images — только там есть размер, качество и правка по образцу.
   * SDK такого эндпоинта не знает, поэтому дёргаем его через client.post:
   * так сохраняются базовый адрес, ключ, keep-alive и повторы.
   */
  private async requestOne(
    model: string,
    references: ImageReference[],
    dto: GenerateImagesDto,
  ): Promise<GeneratedImageDto[]> {
    const result = await this.router!.post<unknown, OpenRouterImagesResponse>(
      '/images',
      {
        body: {
          model,
          // Стиль карточки дописываем сами и в конце: так он не спорит с
          // описанием товара, а уточняет подачу.
          prompt: `${dto.prompt.trim()}\n\n${CARD_STYLE}`,
          n: 1,
          size: dto.size ?? '1024x1024',
          quality: dto.quality ?? 'medium',
          input_references: references,
        },
        timeout: IMAGE_TIMEOUT_MS,
        maxRetries: 2,
      },
    );

    const saved: GeneratedImageDto[] = [];
    for (const item of result.data ?? []) {
      if (!item.b64_json) continue;
      const key = await this.files.saveBuffer(
        Buffer.from(item.b64_json, 'base64'),
        item.media_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      );
      saved.push({ key, url: this.files.buildPublicUrl(key) });
    }
    return saved;
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
