import {
  BadRequestException,
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
import { PushService } from './push.service';
import {
  BROADCAST_AUDIENCES,
  BroadcastAudienceCountDto,
  BroadcastDto,
  BroadcastStartedDto,
  type BroadcastAudience,
  CreateBroadcastDto,
} from './dto/create-broadcast.dto';

@ApiTags('broadcasts-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/broadcasts')
export class AdminBroadcastsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'История рассылок' })
  @ApiResponse({ status: 200, type: [BroadcastDto] })
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
    if (!BROADCAST_AUDIENCES.includes(audience)) {
      throw new BadRequestException(
        `Неизвестная аудитория. Допустимо: ${BROADCAST_AUDIENCES.join(', ')}.`,
      );
    }
    const [count, push] = await Promise.all([
      this.notifications.countAudience(audience),
      this.push.countAudience(audience),
    ]);
    return { count, push };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Запустить рассылку в Telegram (доставка идёт в фоне)',
  })
  @ApiResponse({ status: 200, type: BroadcastStartedDto })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBroadcastDto,
  ) {
    return this.notifications.broadcast(user.id, dto.audience, dto.text);
  }
}
