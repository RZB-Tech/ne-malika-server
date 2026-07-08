import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENAI_CLIENT } from '../openai/openai-client.provider';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly configService: ConfigService,
    private readonly productCardsRepository: ProductCardsRepository,
  ) {}

  /**
   * Генерирует и сохраняет эмбеддинг name + description для карточки.
   * Вызывается фоново при создании/обновлении товара (раздел 6.1 ТЗ).
   * Никогда не бросает исключение — при сбое карточка остаётся без
   * эмбеддинга и просто не участвует в векторном шаге поиска до
   * следующего успешного пересчёта (раздел 6.5 ТЗ).
   */
  async generateAndSaveEmbedding(productCardId: number): Promise<void> {
    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) {
      this.logger.warn(
        `OPENAI_API_KEY не задан — пропускаем эмбеддинг карточки #${productCardId}`,
      );
      return;
    }

    const card = await this.productCardsRepository.findById(productCardId);
    if (!card) return;

    const input = [card.name, card.description].filter(Boolean).join('\n');
    if (!input.trim()) return;

    try {
      const model = this.configService.get<string>('openai.embeddingModel')!;
      const response = await this.openai.embeddings.create({ model, input });
      const embedding = response.data[0]?.embedding;

      if (!embedding) {
        throw new Error('Пустой ответ Embedding API');
      }

      await this.productCardsRepository.updateEmbedding(
        productCardId,
        embedding,
      );
      this.logger.log(`Эмбеддинг карточки #${productCardId} сохранён`);
    } catch (err) {
      this.logger.error(
        `Не удалось получить эмбеддинг карточки #${productCardId}: ${(err as Error).message}`,
      );
    }
  }

  /** Получить эмбеддинг произвольного текста — используется поиском (шаг 2 каскада). */
  async embedQuery(text: string): Promise<number[] | null> {
    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) return null;

    try {
      const model = this.configService.get<string>('openai.embeddingModel')!;
      const response = await this.openai.embeddings.create({
        model,
        input: text,
      });
      return response.data[0]?.embedding ?? null;
    } catch (err) {
      this.logger.warn(
        `Не удалось получить эмбеддинг запроса: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
