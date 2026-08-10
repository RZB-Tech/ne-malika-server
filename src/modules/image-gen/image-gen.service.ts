import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { GROQ_CLIENT } from '../groq/groq-client.provider';
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
    @Inject(GROQ_CLIENT) private readonly groq: OpenAI | null,
    private readonly files: FilesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Промпт по фотографии — кнопка «сгенерировать промпт» в админке. Пишет его
   * Groq, а не OpenAI: он уже читает фото товаров в ИИ-проверке и стоит дешевле,
   * а рисование всё равно уходит в OpenAI.
   */
  async describePrompt(photoKey: string): Promise<{ prompt: string }> {
    if (!this.groq) {
      throw new ServiceUnavailableException(
        'Groq не настроен — промпт можно написать вручную',
      );
    }

    const model = this.config.get<string>('groq.model')!;
    try {
      const completion = await this.groq.chat.completions.create(
        {
          model,
          reasoning_effort: 'none',
          messages: [
            { role: 'system', content: PROMPT_SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Опиши товар с этой фотографии.' },
                {
                  type: 'image_url',
                  image_url: { url: this.files.buildPublicUrl(photoKey) },
                },
              ],
            },
          ],
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        { timeout: PROMPT_TIMEOUT_MS, maxRetries: 1 },
      );

      const prompt = cleanPrompt(completion.choices[0]?.message?.content);
      if (!prompt) {
        throw new Error('модель вернула пустой промпт');
      }
      return { prompt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Промпт по фото ${photoKey} не составлен: ${message}`);
      throw new BadGatewayException(
        'Не удалось составить промпт — попробуйте ещё раз или напишите его сами',
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
    const images = await Promise.all(
      sources.map(async (key, i) =>
        toFile(await this.download(key), `source-${i}.png`, {
          type: 'image/png',
        }),
      ),
    );

    let result: OpenAI.Images.ImagesResponse;
    try {
      result = await this.openai.images.edit(
        {
          model,
          image: images.length === 1 ? images[0] : images,
          prompt: dto.prompt,
          n: count,
          // Размеры вроде 2048x2048 и 3840x2160 принимает gpt-image-2, но в
          // типах SDK перечислены только старые — union там отстаёт от API.
          size: (dto.size ?? '1024x1024') as ImageEditSize,
          quality: dto.quality ?? 'medium',
        },
        { timeout: IMAGE_TIMEOUT_MS, maxRetries: 1 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Генерация по фото ${dto.photoKey} упала: ${message}`);
      throw new BadGatewayException(`Генерация не удалась: ${message}`);
    }

    const saved: GeneratedImageDto[] = [];
    for (const item of result.data ?? []) {
      if (!item.b64_json) continue;
      const key = await this.files.saveBuffer(
        Buffer.from(item.b64_json, 'base64'),
        'image/png',
      );
      saved.push({ key, url: this.files.buildPublicUrl(key) });
    }

    if (saved.length === 0) {
      throw new BadGatewayException('Модель не вернула ни одной картинки');
    }

    this.logger.log(
      `Сгенерировано ${saved.length} фото по товару из ключа ${dto.photoKey}`,
    );
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
 * Модель просили ответить голым текстом, но она может обернуть его в кавычки
 * или блок кода — снимаем обёртку, чтобы админ не правил это руками.
 */
function cleanPrompt(raw: string | null | undefined): string {
  let text = (raw ?? '').trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '');
  text = text.replace(/^["«»']+/, '').replace(/["«»']+$/, '');
  return text.trim();
}
