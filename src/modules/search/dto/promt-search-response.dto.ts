import { ApiProperty } from '@nestjs/swagger';

export class PromptSearchResponseDto {
  @ApiProperty({
    description: 'Найденные товары (та же пагинация, что и GET /product-cards)',
  })
  data: unknown[];

  @ApiProperty()
  meta: { page: number; limit: number; total: number; totalPages: number };

  @ApiProperty({
    description:
      'Параметры, которые ИИ извлёк из промпта и реально применил к поиску',
  })
  appliedParams: Record<string, unknown>;

  @ApiProperty({
    description:
      'true, если OpenAI был недоступен/дал невалидный ответ и использован обычный текстовый поиск',
  })
  usedFallback: boolean;
}
