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
import { describeError, usageCost } from '../openrouter/openrouter.util';
import type {
  ImageReference,
  OpenRouterImagesResponse,
} from '../openrouter/openrouter.images';
import { errorMessage } from '../../common/errors';
import { FilesService } from '../files/files.service';
import { ImageGenRepository } from './image-gen.repository';
import { CreditsService, type CreditHold } from '../credits/credits.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import {
  estimateImagesUsd,
  estimatePromptUsd,
} from '../credits/credits.constants';
import {
  DESCRIPTION_MAX,
  DescribePromptDto,
  GenerateImagesDto,
  GeneratedImageDto,
  MAX_GENERATED_IMAGES,
  RewriteDescriptionDto,
} from './dto/generate-images.dto';

const HISTORY_LIMIT = 24;

const IMAGE_TIMEOUT_MS = 180_000;
const PROMPT_TIMEOUT_MS = 60_000;

const PROMPT_SYSTEM_CARD = `You write prompts for an image generator. The result must be a vertical marketplace listing card in the style of Wildberries or Ozon: a photoreal product composited onto a designed background with Russian marketing text over it. Not a bare studio photo, not a lifestyle scene.

Reply with the prompt itself only: plain English text, no JSON, no quotes around the whole answer, no preamble like "Here is the prompt:".

Build the prompt in this order:
1. The product: type, brand and model if they are readable, colour, material, and the details that must survive — ports, buttons, cable, screen, logo placement.
2. The hero shot: product large and angled, filling most of the frame, dramatic studio light with a rim highlight, realistic reflection and contact shadow.
3. The background: describe only the mood and how the light falls — how the glow sits behind the product, whether the scene is dark and dramatic or bright and airy. Do not name any background colour: the palette is chosen separately for every variant. Never plain white.
4. The Russian text, every string quoted verbatim in double quotes:
   - a heavy bold Cyrillic headline across the top, one or two words naming the main benefit;
   - a small brand or model line above the headline;
   - two or three feature callouts placed next to the part they describe, each a short Cyrillic label with a number or unit, sitting in a rounded badge or coloured block.
5. Layout words: clean commercial e-commerce infographic, flat vector badges over a photoreal product, high contrast, generous margins.

Only state specs that are visible in the photo or printed on the product. When a number is unknown use a benefit word instead: "Беспроводная", "Компактный", "Быстрая зарядка", "4 в 1".

Keep it under 130 words.`;

const DESCRIPTION_SYSTEM = `Ты редактор объявлений на маркетплейсе компьютерной техники. Тебе дают текст продавца и фотографию товара. Верни готовое описание — и ничего больше: без вступлений вроде «Вот описание:» и без кавычек вокруг ответа.

Что делать:
- исправь орфографию, грамматику, пунктуацию и КАПС;
- сохрани все факты продавца: модель, состояние, комплектацию, гарантию, количество;
- сверься с фотографией и добавь только то, что на ней видно: цвет, разъёмы, проводной или беспроводной, форм-фактор, комплектацию в кадре;
- пиши на том же языке, на котором писал продавец (русский, узбекская латиница или узбекская кириллица). Если текста не было — по-русски.

Разметка — markdown, но только эта:
- обычные абзацы, разделённые пустой строкой;
- список пунктов через «- » в начале строки;
- **жирный** для названия параметра внутри пункта, например «- **Подсветка:** RGB».
Ничего другого: без заголовков (#), таблиц, ссылок, картинок, цитат и блоков кода — витрина их не покажет.

Хорошая структура: одно-два предложения о товаре, пустая строка, затем 3–5 пунктов списка с тем, что действительно известно.

Чего не делать:
- не придумывай характеристики, которых нет ни в тексте, ни на фото: частоты, объёмы памяти, год выпуска, срок гарантии;
- не переписывай в описание паспортные данные узнанной модели по памяти: даже когда ты уверен, что это за модель, годится только напечатанное на коробке или корпусе в кадре и сказанное продавцом — продают конкретную вещь, а не спецификацию с сайта производителя;
- не спорь с фотографией: если надпись на упаковке не сходится с тем, что ты помнишь о модели («wireless» у модели, которая бывает только проводной), верь надписи и не приписывай товару свойств из памяти;
- не пиши телефоны, ссылки, ник в Telegram, цену и призывы «пишите в директ» — для связи на сайте есть своя кнопка, а такие объявления снимает модерация;
- не добавляй эмодзи и рекламные восклицания.

Объём: до 700 символов вместе с разметкой. Если фактов мало — короткий текст лучше выдуманного длинного, а список можно и не делать.`;

const PROMPT_SYSTEM_PHOTO = `You write prompts for an image generator. The result must look like a marketplace product listing photo (like Amazon or Ozon), not an advertisement or a lifestyle scene.

Reply with the prompt itself only: plain English text, no JSON, no quotes around it, no preamble like "Here is the prompt:".

Describe the product itself — type, recognizable model, colour, material — and then the shot: product centred and filling most of the frame, three-quarter or front view, pure white seamless background, soft even studio light, subtle contact shadow under the product.

Critical: the bare product only. Never a box, never retail packaging, never a product sitting in or next to a package. No hands, no people, no props, no furniture, no room, no text, no captions, no labels added, no brand logos of stores, no collage, no watermark, no borders.

Do not invent specs you cannot see in the photo. If the model is unrecognizable, describe what is visible in general terms.

Keep it under 60 words.`;

const PROMPT_WITH_REFERENCE = [
  'IMAGE 1 is the product photo. IMAGE 2 is a finished card whose design must be copied.',
  'Describe the product from IMAGE 1 placed into the layout of IMAGE 2:',
  'repeat the background, colour scheme, text block positions, badge shapes and typography weight of IMAGE 2,',
  'but write new Russian wording that fits the product from IMAGE 1.',
  'Never describe the product or reuse the wording from IMAGE 2.',
].join(' ');

const REFERENCE_ROLES = [
  'Two images are provided.',
  'IMAGE 1 is the product: reproduce its exact model, shape, colour, ports, buttons and markings.',
  'IMAGE 2 is the design reference: copy its layout, background, colour scheme, lighting, text placement, badge shapes and typography weight.',
  'Take only the design from IMAGE 2 — never its product and never its wording.',
].join(' ');

const REFERENCE_STYLE = [
  'Render every Russian word in correct, sharp Cyrillic — no invented letters, no misspellings, no Latin transliteration.',
  'No watermark, no marketplace logo, no placeholder text.',
].join(' ');

const CARD_STYLE = [
  'Vertical marketplace listing card, Wildberries / Ozon style infographic.',
  'Photoreal product composited on a designed background: glow and rim light behind the product, realistic contact shadow.',
  'Heavy bold Cyrillic headline, short Russian feature callouts in badges beside the parts they describe.',
  'Render every Russian word in correct, sharp Cyrillic — no invented letters, no misspellings, no Latin transliteration.',
  'Clean commercial layout, generous margins, high contrast, no watermark, no marketplace logo, no placeholder text.',
].join(' ');

const CARD_DIRECTIONS = [
  'Art direction: charcoal-to-black gradient background with a warm amber glow behind the product; headline block in the top-left corner; callout badges outlined in amber.',
  'Art direction: graphite background with a magenta-to-violet neon rim and a faint tech grid; headline in the top-right corner; callouts in dark rounded pills.',
  'Art direction: bright studio background, soft grey-to-white gradient with a long soft shadow; near-black heavy headline across the top; callouts in flat saturated colour blocks.',
  'Art direction: emerald-to-teal gradient background with a lime accent; a diagonal band running behind the headline; callouts as circular badges.',
  'Art direction: warm sand and cream background with a soft peach glow; dark brown headline; callouts in white rounded cards with thin drop shadows.',
  'Art direction: crimson-to-black background with a hot orange rim light and drifting smoke; condensed headline stacked at the top; callouts in black pills with orange edges.',
  'Art direction: icy white-to-pale-blue background with crisp geometric shapes; navy headline; callouts as thin outlined tags.',
  'Art direction: matte purple-to-indigo background with a hard spotlight from above; headline centred at the top; callouts in glassy translucent panels.',
  'Art direction: concrete-grey textured background cut by one bright yellow diagonal stripe; black headline inside a yellow block; square tags for the callouts.',
  'Art direction: near-monochrome scene with a single saturated accent colour taken from the product itself; oversized headline; minimal thin-line callouts with leader lines.',
];

const PHOTO_STYLE = [
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
    private readonly repository: ImageGenRepository,
    private readonly credits: CreditsService,
    private readonly aiUsage: AiUsageService,
  ) {}

  private async settleAndLog(
    hold: CreditHold | null,
    author: { id: number; isAdmin: boolean },
    usd: number | undefined,
    meta: {
      operation: 'prompt' | 'description' | 'image';
      model: string;
      images?: number;
    },
  ): Promise<void> {
    const credits = await this.credits.settle(hold, usd, meta);
    await this.aiUsage.record({
      userId: author.id,
      shopId: hold?.shopId ?? null,
      operation: meta.operation,
      model: meta.model,
      images: meta.images,
      usd,
      credits,
    });
  }

  async balance(
    userId: number,
    isAdmin: boolean,
  ): Promise<{ allowed: boolean; credits: number | null }> {
    if (isAdmin) return { allowed: true, credits: null };

    const shopId = await this.credits.shopIdOf(userId);
    if (!shopId) return { allowed: false, credits: 0 };

    const available = await this.credits.available(shopId);
    return { allowed: available > 0, credits: available };
  }

  async history(userId: number, sourceKey: string) {
    const rows = await this.repository.history(
      userId,
      sourceKey,
      HISTORY_LIMIT,
    );
    return rows.map((row) => ({
      key: row.key,
      url: this.files.buildPublicUrl(row.key),
      prompt: row.prompt,
      createdAt: row.createdAt,
    }));
  }

  async describePrompt(
    dto: DescribePromptDto,
    author: { id: number; isAdmin: boolean },
  ): Promise<{ prompt: string }> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — промпт можно написать вручную',
      );
    }

    const hold = await this.credits.hold(
      author,
      estimatePromptUsd(),
      'составление промпта',
    );

    const model = this.config.get<string>('openrouter.visionModel')!;
    const withReference = Boolean(dto.referenceKey);
    const system =
      dto.style === 'photo' ? PROMPT_SYSTEM_PHOTO : PROMPT_SYSTEM_CARD;

    try {
      const images = await Promise.all(
        [dto.photoKey, ...(dto.referenceKey ? [dto.referenceKey] : [])].map(
          async (key) => ({
            type: 'image_url' as const,
            image_url: {
              url: await this.files.toDataUrl(key),
              detail: 'low' as const,
            },
          }),
        ),
      );
      const completion = await this.router.chat.completions.create(
        {
          model,
          max_completion_tokens: 1000,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: withReference
                    ? PROMPT_WITH_REFERENCE
                    : 'Write the image prompt for this product photo.',
                },
                ...images,
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

      await this.settleAndLog(hold, author, usageCost(completion.usage), {
        operation: 'prompt',
        model,
      });

      return { prompt };
    } catch (err) {
      throw await this.gatewayFailure(
        err,
        hold,
        `Промпт по фото ${dto.photoKey} не составлен (модель ${model})`,
        'Не удалось составить промпт',
      );
    }
  }

  async rewriteDescription(
    dto: RewriteDescriptionDto,
    author: { id: number; isAdmin: boolean },
  ): Promise<{ text: string }> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — описание можно поправить вручную',
      );
    }

    const hold = await this.credits.hold(
      author,
      estimatePromptUsd(),
      'правка описания',
    );

    const model = this.config.get<string>('openrouter.visionModel')!;

    try {
      const photo = await this.files.toDataUrl(dto.photoKey);
      const source = dto.text.trim();

      const completion = await this.router.chat.completions.create(
        {
          model,
          max_completion_tokens: 700,
          messages: [
            { role: 'system', content: DESCRIPTION_SYSTEM },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    dto.name ? `Название товара: ${dto.name}` : null,
                    source
                      ? `Описание продавца:\n${source}`
                      : 'Продавец описание не написал — составь его по фотографии.',
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                },
                {
                  type: 'image_url' as const,
                  // Здесь с фотографии читают факты (надписи на коробке,
                  // разъёмы, комплектацию), а не композицию, — превью
                  // 512×512 для этого мало.
                  image_url: { url: photo, detail: 'high' as const },
                },
              ],
            },
          ],
        },
        { timeout: PROMPT_TIMEOUT_MS, maxRetries: 1 },
      );

      const choice = completion.choices[0];
      const text = cleanPrompt(choice?.message?.content).slice(
        0,
        DESCRIPTION_MAX,
      );
      if (!text) {
        throw new Error(
          `модель вернула пустой текст (finish_reason: ${choice?.finish_reason ?? '—'})`,
        );
      }

      await this.settleAndLog(hold, author, usageCost(completion.usage), {
        operation: 'description',
        model,
      });

      return { text };
    } catch (err) {
      throw await this.gatewayFailure(
        err,
        hold,
        `Описание по фото ${dto.photoKey} не исправлено (модель ${model})`,
        'Не удалось исправить описание',
      );
    }
  }

  private async gatewayFailure(
    err: unknown,
    hold: CreditHold | null,
    logContext: string,
    action: string,
  ): Promise<BadGatewayException> {
    await this.credits.cancel(hold);

    const details = describeError(err);
    this.logger.error(`${logContext}: ${details}`);

    const status = (err as { status?: number }).status;
    return new BadGatewayException(
      status === 429
        ? `Лимит запросов исчерпан. ${details}`
        : `${action}: ${details}`,
    );
  }

  async generate(
    dto: GenerateImagesDto,
    author: { id: number; isAdmin: boolean },
  ): Promise<GeneratedImageDto[]> {
    if (!this.router) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY не задан — генерация фотографий отключена',
      );
    }

    const count = Math.min(dto.count ?? 2, MAX_GENERATED_IMAGES);
    const size = dto.size ?? '960x1280';

    const hold = await this.credits.hold(
      author,
      estimateImagesUsd(size, dto.quality, count, dto.referenceKey ? 2 : 1),
      'генерацию',
    );

    try {
      return await this.run(dto, count, size, author, hold);
    } catch (err) {
      await this.credits.cancel(hold);
      throw err;
    }
  }

  private async run(
    dto: GenerateImagesDto,
    count: number,
    size: string,
    author: { id: number; isAdmin: boolean },
    hold: CreditHold | null,
  ): Promise<GeneratedImageDto[]> {
    const model = this.config.get<string>('openrouter.imageModel')!;

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
      const message = errorMessage(err);
      this.logger.error(
        `Исходное фото ${dto.photoKey} не прочитано: ${message}`,
      );
      throw new BadGatewayException(
        `Не удалось прочитать исходное фото из хранилища: ${message}`,
      );
    }

    const directions = pickDirections(count);
    const attempts = await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        this.requestOne(model, references, dto, size, directions[i]),
      ),
    );

    const saved: GeneratedImageDto[] = [];
    let usd = 0;
    let priced = false;
    for (const attempt of attempts) {
      if (attempt.status !== 'fulfilled') continue;
      saved.push(...attempt.value.images);
      if (attempt.value.usd !== undefined) {
        usd += attempt.value.usd;
        priced = true;
      }
    }

    if (saved.length > 0) {
      await this.settleAndLog(hold, author, priced ? usd : undefined, {
        operation: 'image',
        model,
        images: saved.length,
      });
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

    try {
      await this.repository.record(
        saved.map((image) => ({
          userId: author.id,
          sourceKey: dto.photoKey,
          key: image.key,
          prompt: dto.prompt.trim(),
        })),
      );
    } catch (err) {
      this.logger.error(
        `Не удалось записать сгенерированные картинки: ${errorMessage(err)}`,
      );
    }

    const failed = count - saved.length;
    this.logger.log(
      `Сгенерировано ${saved.length} из ${count} фото по ключу ${dto.photoKey}` +
        (failed > 0 ? ` (${failed} попыток не удалось)` : ''),
    );
    return saved;
  }

  private async requestOne(
    model: string,
    references: ImageReference[],
    dto: GenerateImagesDto,
    size: string,
    direction: string,
  ): Promise<{ images: GeneratedImageDto[]; usd?: number }> {
    const result = await this.router!.post<unknown, OpenRouterImagesResponse>(
      '/images',
      {
        body: {
          model,
          prompt: [
            dto.prompt.trim(),
            ...styleTail(references.length, dto, direction),
          ].join('\n\n'),
          n: 1,
          size,
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
    return { images: saved, usd: usageCost(result.usage) };
  }
}

function styleTail(
  referenceCount: number,
  dto: GenerateImagesDto,
  direction: string,
): string[] {
  if (referenceCount > 1) return [REFERENCE_ROLES, REFERENCE_STYLE];
  if (dto.style === 'photo') return [PHOTO_STYLE];
  return [
    CARD_STYLE,
    `${direction} Follow this art direction unless the description above already names a background or a colour scheme.`,
  ];
}

function pickDirections(count: number): string[] {
  const start = Math.floor(Math.random() * CARD_DIRECTIONS.length);
  return Array.from(
    { length: count },
    (_, i) => CARD_DIRECTIONS[(start + i) % CARD_DIRECTIONS.length],
  );
}

function cleanPrompt(raw: string | null | undefined): string {
  let text = (raw ?? '').trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '');
  text = text.replace(/^["«»']+/, '').replace(/["«»']+$/, '');
  return text.trim();
}
