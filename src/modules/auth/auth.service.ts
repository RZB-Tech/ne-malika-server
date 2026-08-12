import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import {
  TelegramUserPayload,
  validateTelegramInitData,
  validateTelegramWidgetData,
} from './telegram-signature.util';
import { TelegramWidgetDto } from './dto/telegram-widget.dto';
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

  /** Telegram Mini App: подписанная строка initData из window.Telegram.WebApp. */
  authenticateWithTelegram(initData: string) {
    return this.login((token, ttl) =>
      validateTelegramInitData(initData, token, ttl),
    );
  }

  /**
   * Браузерный вход: ответ Telegram Login Widget уже подписан Telegram —
   * проверяем подпись здесь, токен бота на клиент не уезжает.
   */
  authenticateWithWidget(dto: TelegramWidgetDto) {
    return this.login((token, ttl) =>
      validateTelegramWidgetData(dto, token, ttl),
    );
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
    this.assertNotBlocked(user);

    return this.issueTokens(user);
  }

  private async login(
    validate: (botToken: string, ttlSec: number) => TelegramUserPayload,
  ) {
    const botToken = this.configService.get<string>('telegram.botToken');
    if (!botToken) {
      throw new UnauthorizedException(
        'Telegram-авторизация временно недоступна',
      );
    }
    const ttlSec = this.configService.get<number>('telegram.initDataTtlSec')!;

    let payload: TelegramUserPayload;
    try {
      payload = validate(botToken, ttlSec);
    } catch (err) {
      throw new UnauthorizedException((err as Error).message);
    }

    const user = await this.usersService.findOrCreateFromTelegram(payload);
    this.assertNotBlocked(user);
    return this.issueTokens(user);
  }

  /**
   * Проверяем при входе и обновлении токена, а не в guard'е: иначе каждый
   * запрос к API тянул бы за собой чтение пользователя из БД. Уже выданный
   * access-токен доживает свой недолгий срок — это осознанный размен.
   */
  private assertNotBlocked(user: User) {
    if (user.blockedAt) {
      throw new ForbiddenException(
        user.blockReason
          ? `Аккаунт заблокирован: ${user.blockReason}`
          : 'Аккаунт заблокирован администратором',
      );
    }
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

    return {
      accessToken: this.jwtService.sign(accessPayload, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessTtl'),
      }),
      refreshToken: this.jwtService.sign(refreshPayload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshTtl'),
      }),
      user: {
        id: user.id,
        fullname: user.fullname,
        role: user.role,
        telegramUsername: user.telegramUsername,
        telegramPhoto: user.telegramPhoto,
        phoneNumber: user.phoneNumber,
        hasContact: Boolean(user.phoneNumber),
        telegramLinked: Boolean(user.telegramChatId),
      },
    };
  }
}
