import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENAI_CLIENT } from '../openai/openai-client.provider';
import { AiProductChecksRepository } from './ai-product-checks.repository';
import { FilesService } from '../files/files.service';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { ShopsRepository } from '../shops/shops.repository';
import {
  AI_PRODUCT_CHECK_JSON_SCHEMA,
  AiProductCheckResult,
  AiVerdict,
} from './types/ai-check-result.types';

const SYSTEM_PROMPT = `Ты — модератор карточек товаров маркетплейса компьютерной техники "НеМалика".
Проверь карточку товара по 4 критериям и верни строго структурированный JSON:

1. description — полнота и читаемость описания, отсутствие спама или запрещённого контента.
2. dataConsistency — правдоподобность цены для данного товара, согласованность полей между собой.
3. photos — действительно ли на фото виден заявленный товар, приемлемое качество, отсутствие постороннего/неприемлемого контента.
4. photoMatch — соответствуют ли фото описанию и наоборот (модель, состояние, комплектация).

Для каждого критерия укажи verdict (pass/warn/fail) и короткую заметку notes на русском языке.
Итоговый verdict — это наихудший из четырёх (fail, если хоть один fail; иначе warn, если хоть один warn; иначе pass).
summary — 1-2 предложения общего резюме на русском.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly configService: ConfigService,
    private readonly aiProductChecksRepository: AiProductChecksRepository,
    private readonly filesService: FilesService,
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly shopsRepository: ShopsRepository,
  ) {}

  async checkProductCard(productCardId: number): Promise<void> {
    const model = this.configService.get<string>('openai.model')!;
    const apiKey = this.configService.get<string>('openai.apiKey');

    if (!apiKey) {
      this.logger.warn(
        `OPENAI_API_KEY не задан — пропускаем ИИ-проверку карточки #${productCardId}`,
      );
      await this.saveError(
        productCardId,
        model,
        'OpenAI недоступен: нет API-ключа',
      );
      return;
    }

    const card = await this.productCardsRepository.findById(productCardId);
    if (!card) {
      this.logger.warn(
        `Карточка #${productCardId} не найдена — проверка отменена`,
      );
      return;
    }
    const shop = await this.shopsRepository.findById(card.shopId);

    const photoUrls = card.photos.map((key) =>
      this.filesService.buildPublicUrl(key),
    );

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  name: card.name,
                  description: card.description,
                  price: card.price,
                  state: card.state,
                  shopName: shop?.name,
                }),
              },
              ...photoUrls.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: AI_PRODUCT_CHECK_JSON_SCHEMA,
        },
      });

      const rawContent = response.choices[0]?.message?.content;
      if (!rawContent) {
        throw new Error('Пустой ответ от OpenAI');
      }

      const result = JSON.parse(rawContent) as AiProductCheckResult;
      const tokensUsed = response.usage?.total_tokens;

      await this.aiProductChecksRepository.create({
        productCardId,
        verdict: result.verdict,
        checks: result.checks,
        summary: result.summary,
        model,
        tokensUsed,
      });

      await this.applyVisibility(productCardId, result.verdict, card.status);

      this.logger.log(
        `ИИ-проверка карточки #${productCardId} завершена: ${result.verdict} (${tokensUsed ?? '?'} токенов)`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `ИИ-проверка карточки #${productCardId} не удалась: ${message}`,
      );
      await this.saveError(productCardId, model, message);
      // При сбое самой проверки видимость не трогаем — карточка остаётся в
      // текущем статусе ("публикуется без проверки", раздел 7 ТЗ).
    }
  }

  getLatestCheck(productCardId: number) {
    return this.aiProductChecksRepository.findLatestByProductCardId(
      productCardId,
    );
  }

  private async applyVisibility(
    productCardId: number,
    verdict: AiVerdict,
    currentStatus: string,
  ) {
    if (verdict === 'fail') {
      if (currentStatus !== 'abolished') {
        await this.productCardsRepository.hide(productCardId);
      }
      return;
    }

    if (currentStatus === 'hidden') {
      await this.productCardsRepository.restore(productCardId);
    }
  }

  private async saveError(productCardId: number, model: string, error: string) {
    await this.aiProductChecksRepository.create({
      productCardId,
      verdict: 'warn',
      checks: {},
      model,
      error,
    });
  }
}
