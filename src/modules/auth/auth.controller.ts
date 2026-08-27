import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { type Request, type Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { TelegramWidgetDto } from './dto/telegram-widget.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

const REFRESH_COOKIE = 'refresh_token';

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Tokens = Awaited<ReturnType<AuthService['refresh']>>;

@ApiTags('auth')
@Public()
@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller('auth')
export class AuthController {
  private readonly refreshCookiePath: string;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    const prefix = this.configService.get<string>('apiPrefix') ?? '';
    this.refreshCookiePath = `/${prefix}/auth`.replace(/\/{2,}/g, '/');
  }

  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход через Telegram Mini App (initData)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Невалидная подпись или срок истёк',
  })
  async telegramAuth(
    @Body() dto: TelegramAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      await this.authService.authenticateWithTelegram(dto.initData),
      res,
    );
  }

  @Post('telegram/widget')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход через Telegram Login Widget (браузер)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Невалидная подпись или срок истёк',
  })
  async widgetAuth(
    @Body() dto: TelegramWidgetDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      await this.authService.authenticateWithWidget(dto),
      res,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновление access-токена по httpOnly refresh-cookie',
  })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Refresh-токен отсутствует или недействителен',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string | undefined>;
    return this.respond(
      await this.authService.refresh(cookies?.[REFRESH_COOKIE]),
      res,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выход — очищает refresh-cookie' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: this.refreshCookiePath });
    return { success: true };
  }

  private respond(
    { accessToken, refreshToken, user }: Tokens,
    res: Response,
  ): AuthResponseDto {
    const isProd = this.configService.get('env') === 'production';
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: this.refreshCookiePath,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
    return { accessToken, user };
  }
}
