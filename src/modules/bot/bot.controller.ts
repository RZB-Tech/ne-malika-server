import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { BotService } from './bot.service';
import { type TelegramUpdate } from './types/telegram-update.types';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller('bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    private readonly botService: BotService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ) {
    const expectedSecret = this.configService.get<string>(
      'telegram.webhookSecret',
    );
    if (!expectedSecret) {
      this.logger.error(
        'TELEGRAM_WEBHOOK_SECRET не задан — вебхук отклоняет запросы',
      );
      throw new UnauthorizedException('Вебхук не настроен');
    }
    if (secretHeader !== expectedSecret) {
      throw new UnauthorizedException('Неверный секрет вебхука');
    }

    this.botService.handleUpdate(update).catch((err: Error) => {
      this.logger.error('Ошибка обработки апдейта бота', err.stack);
    });

    return { ok: true };
  }
}
