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

  @Get('totals')
  @ApiOperation({
    summary:
      'Итоги за всё время: число запросов, расход у OpenRouter и снятые кредиты',
  })
  totals() {
    return this.aiUsage.totals();
  }
}
