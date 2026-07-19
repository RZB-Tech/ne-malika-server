import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { validateTelegramInitData } from './telegram-init-data.util';
import {
  JwtAccessPayload,
  JwtRefreshPayload,
} from '../../common/types/auth.types';
import { User } from '../../db/schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async authenticateWithTelegram(initData: string) {
    const botToken = this.configService.get<string>('telegram.botToken');
    const ttlSec = this.configService.get<number>('telegram.initDataTtlSec')!;

    if (!botToken) {
      throw new UnauthorizedException(
        'Telegram-авторизация временно недоступна',
      );
    }

    let parsed: ReturnType<typeof validateTelegramInitData>;
    try {
      parsed = validateTelegramInitData(initData, botToken, ttlSec);
    } catch (err) {
      throw new UnauthorizedException((err as Error).message);
    }

    const user = await this.usersService.findOrCreateFromTelegram(parsed.user);
    const tokens = this.issueTokens(user);

    return {
      ...tokens,
      user: this.toPublicProfile(user),
    };
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('Отсутствует refresh-токен');
    }

    let payload: JwtRefreshPayload;
    try {
      payload = this.jwtService.verify<JwtRefreshPayload>(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Недействительный refresh-токен');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Неверный тип токена');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return this.issueTokens(user);
  }

  private issueTokens(user: User) {
    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      role: user.role,
      type: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      role: user.role,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: this.configService.get<string>('jwt.accessTtl'),
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>('jwt.refreshTtl'),
    });

    return { accessToken, refreshToken, user };
  }

  private toPublicProfile(user: User) {
    return {
      id: user.id,
      fullname: user.fullname,
      role: user.role,
      telegramUsername: user.telegramUsername,
      telegramPhoto: user.telegramPhoto,
      phoneNumber: user.phoneNumber,
      hasContact: Boolean(user.phoneNumber),
    };
  }
}
