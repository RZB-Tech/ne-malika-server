import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Locale } from '../../common/decorators/locale.decorator';
import type { ApiLocale } from '../../common/i18n/locale';
import { AiCompareService } from './ai-compare.service';
import { AiCompareQueryDto, AiCompareResultDto } from './dto/ai-compare.dto';

@ApiTags('ai-compare')
@Public()
@Controller('ai-compare')
export class AiCompareController {
  constructor(private readonly aiCompareService: AiCompareService) {}

  @Get()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'ИИ-сравнение товаров по составляющим',
    description:
      'Разбирает 2–4 товара по железу: строка на составляющую, плюсы и минусы ' +
      'каждого и итог. Бесплатно для покупателя. Повтор с теми же товарами ' +
      'отдаётся из кэша.',
  })
  @ApiOkResponse({ type: AiCompareResultDto })
  @ApiResponse({ status: 400, description: 'Меньше двух доступных товаров' })
  @ApiResponse({ status: 502, description: 'Модель не ответила' })
  @ApiResponse({ status: 503, description: 'ИИ-функции выключены: нет ключа' })
  compare(
    @Query() query: AiCompareQueryDto,
    @Locale() locale: ApiLocale,
  ): Promise<AiCompareResultDto> {
    return this.aiCompareService.compare(query.ids, locale);
  }
}
