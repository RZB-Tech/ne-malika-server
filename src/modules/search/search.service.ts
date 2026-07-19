import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import { EmbeddingsService } from '../ai/embeddings.service';
import { SemanticCacheService } from './semantic-cache.service';
import { PromptSearchDto } from './dto/promt-search.dto';
import { buildPaginatedResult } from 'src/common/dto/paginated-response.dto';

const VECTOR_CANDIDATES_LIMIT = 20;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly productCardsRepository: ProductCardsRepository,
    private readonly embeddingsService: EmbeddingsService,
    private readonly semanticCache: SemanticCacheService,
  ) {}

  async promptSearch(dto: PromptSearchDto) {
    const filters = {
      price_min: dto.price_min,
      price_max: dto.price_max,
      state: dto.state,
      shop_id: dto.shop_id,
      sort: dto.sort,
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
    };

    // Шаг 1 — FTS. Бесплатно, мгновенно, работает даже без OpenAI/Redis.
    const ftsResult = await this.productCardsRepository.fullTextSearch(
      dto.prompt,
      filters,
    );
    if (ftsResult.total > 0) {
      return this.respond(ftsResult.data, ftsResult.total, filters, 'fts');
    }

    // Шаг 2 — векторный поиск. Требует OpenAI (эмбеддинг запроса).
    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) {
      // Раздел 6.5 ТЗ: при недоступности OpenAI каскад останавливается на FTS.
      return this.respond([], 0, filters, 'fts');
    }

    const queryEmbedding = await this.getQueryEmbedding(dto.prompt);
    if (!queryEmbedding) {
      return this.respond([], 0, filters, 'fts');
    }

    const candidates = await this.productCardsRepository.vectorSearch(
      queryEmbedding,
      filters,
      VECTOR_CANDIDATES_LIMIT,
    );

    // Шаг 3 — опциональный LLM re-ranking, только по кандидатам шага 2.

    const finalResults = candidates;
    const stage: string = 'vector';

    // Пагинация применяется уже после каскада — векторный шаг сам по себе
    // не является полным списком (limit 20 кандидатов), поэтому total
    // здесь — это just candidates.length, а не реальный total в каталоге.
    const page = filters.page;
    const limit = filters.limit;
    const paged = finalResults.slice((page - 1) * limit, page * limit);

    return this.respond(paged, finalResults.length, filters, stage);
  }

  private async getQueryEmbedding(prompt: string): Promise<number[] | null> {
    const cached = await this.semanticCache.get(prompt);
    if (cached) return cached;

    const embedding = await this.embeddingsService.embedQuery(prompt);
    if (embedding) {
      await this.semanticCache.set(prompt, embedding);
    }
    return embedding;
  }

  private respond(
    data: unknown[],
    total: number,
    filters: { page: number; limit: number },
    stage: string,
  ) {
    const paginated = buildPaginatedResult(
      data,
      total,
      filters.page,
      filters.limit,
    );
    return { ...paginated, searchStage: stage };
  }
}
