import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { NotificationsService } from './notifications.service';
import {
  BROADCAST_AUDIENCES,
  BroadcastAudienceCountDto,
  type BroadcastAudience,
  CreateBroadcastDto,
} from './dto/create-broadcast.dto';

@ApiTags('broadcasts-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/broadcasts')
export class AdminBroadcastsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'История рассылок' })
  list(@Query() query: PaginationQueryDto) {
    return this.notifications.listBroadcasts(query);
  }

  @Get('audience')
  @ApiOperation({ summary: 'Сколько адресатов получит рассылку' })
  @ApiQuery({ name: 'audience', enum: BROADCAST_AUDIENCES })
  @ApiResponse({ status: 200, type: BroadcastAudienceCountDto })
  async count(
    @Query('audience') audience: BroadcastAudience,
  ): Promise<BroadcastAudienceCountDto> {
    const known = BROADCAST_AUDIENCES.includes(audience) ? audience : 'all';
    return { count: await this.notifications.countAudience(known) };
  }

  /**
   * Лимит жёсткий: каждый запрос — это сообщение всем пользователям сразу.
   * Случайный двойной клик не должен превращаться в две рассылки подряд.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Отправить рассылку в Telegram' })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBroadcastDto,
  ) {
    return this.notifications.broadcast(user.id, dto.audience, dto.text);
  }
}
