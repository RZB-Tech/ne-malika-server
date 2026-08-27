import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { AiUsageService } from './ai-usage.service';
import { FindAiUsageQueryDto } from './dto/find-ai-usage-query.dto';

@ApiTags('ai-usage-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/ai-usage')
export class AdminAiUsageController {
  constructor(private readonly aiUsage: AiUsageService) {}

  @Get()
  @ApiOperation({
    summary:
      'Журнал обращений к ИИ: кто и для какого магазина генерировал, во что это обошлось',
  })
  list(@Query() query: FindAiUsageQueryDto) {
    return this.aiUsage.list(query);
  }

  /**
   * Расход в ответе разложен на три кармана — платный, подписочный и
   * площадочный, — и `usd` теперь означает только первый из них. Маржа на ИИ
   * считается как `usd` против `credits`; весь расход у OpenRouter — как сумма
   * трёх. Разбор — в докблоке `AiUsageRepository.totals`.
   */
  @Get('totals')
  @ApiOperation({
    summary:
      'Итоги за всё время: число запросов, расход у OpenRouter по платным, ' +
      'подписочным и площадочным операциям и снятые кредиты',
  })
  totals() {
    return this.aiUsage.totals();
  }
}
