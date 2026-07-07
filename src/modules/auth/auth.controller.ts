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
import { ConfigService } from '@nestjs/config';
import { type Request, type Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Вход/регистрация продавца или администратора через Telegram initData',
  })
  @ApiResponse({
    status: 200,
    description: 'Успешная авторизация',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Невалидная подпись initData или срок истёк',
  })
  async telegramAuth(
    @Body() dto: TelegramAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } =
      await this.authService.authenticateWithTelegram(dto.initData);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновление access-токена по httpOnly refresh-cookie',
  })
  @ApiResponse({ status: 200, description: 'Новый access-токен выдан' })
  @ApiResponse({
    status: 401,
    description: 'Refresh-токен отсутствует или недействителен',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    const {
      accessToken,
      refreshToken: newRefreshToken,
      user,
    } = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, newRefreshToken);
    return {
      accessToken,
      user: { id: user.id, fullname: user.fullname, role: user.role },
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выход — очищает refresh-cookie' })
  @ApiResponse({ status: 200, description: 'Выход выполнен' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { success: true };
  }

  private setRefreshCookie(res: Response, token: string) {
    const isProd = this.configService.get('env') === 'production';
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}
