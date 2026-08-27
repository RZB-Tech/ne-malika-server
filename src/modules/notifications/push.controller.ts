import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnyRole } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PushService } from './push.service';
import {
  PushConfigDto,
  PushStateDto,
  SubscribePushDto,
  UnsubscribePushDto,
} from './dto/push.dto';

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Публичный ключ VAPID и доступность канала' })
  @ApiResponse({ status: 200, type: PushConfigDto })
  config(): PushConfigDto {
    return { enabled: this.push.isEnabled(), publicKey: this.push.publicKey() };
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Get('state')
  @ApiOperation({ summary: 'Есть ли у пользователя подписка' })
  @ApiResponse({ status: 200, type: PushStateDto })
  async state(@CurrentUser() user: AuthenticatedUser): Promise<PushStateDto> {
    return { subscribed: await this.push.hasSubscription(user.id) };
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подписать браузер на уведомления' })
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
  ): Promise<{ ok: true }> {
    await this.push.subscribe({
      userId: user.id,
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
      userAgent: dto.userAgent,
    });
    return { ok: true };
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Delete('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отписать браузер' })
  async unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnsubscribePushDto,
  ): Promise<{ ok: true }> {
    await this.push.unsubscribe(user.id, dto.endpoint);
    return { ok: true };
  }
}
