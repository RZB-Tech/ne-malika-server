import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { BotService } from './bot.service';
import { type TelegramUpdate } from './types/telegram-update.types';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller('bot')
export class BotController {
  constructor(
    private readonly botService: BotService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ) {
    const expectedSecret = this.configService.get<string>(
      'telegram.webhookSecret',
    );
    if (expectedSecret && secretHeader !== expectedSecret) {
      throw new UnauthorizedException('Неверный секрет вебхука');
    }

    // Обрабатываем асинхронно, но отвечаем Telegram сразу 200 —
    // иначе при медленной обработке Telegram посчитает вебхук недоступным
    // и продолжит ретраить апдейт.
    this.botService.handleUpdate(update).catch((err) => {
      console.error('Ошибка обработки апдейта бота', err);
    });

    return { ok: true };
  }
}
