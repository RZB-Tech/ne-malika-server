import { Body, Controller, HttpCode, Post } from '@nestjs/common';
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
import { AssistantService } from './assistant.service';
import { AssistantRequestDto, AssistantResponseDto } from './dto/assistant.dto';

@ApiTags('assistant')
@Public()
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Помощник покупателя: вопросы, подбор техники и навигация',
  })
  @ApiOkResponse({ type: AssistantResponseDto })
  @ApiResponse({ status: 400, description: 'Некорректная история диалога' })
  @ApiResponse({ status: 429, description: 'Слишком много сообщений' })
  @ApiResponse({ status: 502, description: 'Модель временно недоступна' })
  @ApiResponse({ status: 503, description: 'OpenRouter не настроен' })
  chat(@Body() body: AssistantRequestDto, @Locale() locale: ApiLocale) {
    return this.assistant.chat(body, locale);
  }
}
