import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnyRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { NotificationsService } from './notifications.service';
import {
  NotificationChannelsDto,
  SetTelegramNotificationsDto,
} from './dto/notification-channels.dto';

/**
 * Каналы уведомлений глазами их получателя.
 *
 * Отдельно от `/push`: тот отвечает за подписку конкретного браузера, а здесь
 * человек выбирает, куда вообще получать — в браузер или в Telegram.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Get('channels')
  @ApiOperation({ summary: 'Состояние каналов уведомлений' })
  @ApiResponse({ status: 200, type: NotificationChannelsDto })
  channels(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationChannelsDto> {
    return this.notifications.channels(user.id);
  }

  @AnyRole()
  @ApiBearerAuth('access-token')
  @Patch('telegram')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Включить или выключить уведомления в Telegram' })
  @ApiResponse({ status: 200, type: NotificationChannelsDto })
  async telegram(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetTelegramNotificationsDto,
  ): Promise<NotificationChannelsDto> {
    await this.notifications.setTelegram(user.id, dto.enabled);
    return this.notifications.channels(user.id);
  }
}
