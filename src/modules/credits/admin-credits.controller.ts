import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreditsService } from './credits.service';
import {
  CreditPreviewDto,
  GrantCreditsDto,
  GrantResultDto,
  RevokeCreditsDto,
  RevokeResultDto,
  ShopCreditsDto,
} from './dto/credits.dto';

@ApiTags('credits-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/shops/:shopId/credits')
export class AdminCreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @ApiOperation({ summary: 'Баланс кредитов магазина' })
  @ApiResponse({ status: 200, type: ShopCreditsDto })
  async balance(
    @Param('shopId', ParseIntPipe) shopId: number,
  ): Promise<ShopCreditsDto> {
    const state = await this.credits.balance(shopId);
    if (!state) throw new NotFoundException('Магазин не найден');
    return {
      balance: state.balance,
      reserved: state.reserved,
      /**
       * Готовое `state.available`, а не `balance - reserved` (B5): с появлением
       * подписочного кармана старая формула считала только купленные кредиты.
       * У подписчика PRO с 6000 подписочных и нулём купленных админ видел бы
       * «доступно 0» ровно там, где продавец на своей странице видит 6000, и
       * разбор обращения начинался бы с несуществующей проблемы.
       *
       * `Math.max(0, …)` оставлен: `AVAILABLE_CREDITS` своего `greatest(0, …)`
       * не имеет, а резерв способен пережить магазин, у которого кредиты
       * отобрали, — показывать администратору минус незачем.
       */
      available: Math.max(0, state.available),
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'История начислений и списаний' })
  history(
    @Param('shopId', ParseIntPipe) shopId: number,
    @Query() query: PaginationQueryDto,
  ) {
    return this.credits.history(shopId, query);
  }

  /** Лимит: выдача кредитов — это деньги, случайный двойной клик недопустим. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Начислить кредиты магазину' })
  @ApiResponse({ status: 200, type: GrantResultDto })
  grant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: GrantCreditsDto,
  ): Promise<GrantResultDto> {
    return this.credits.grant(shopId, user.id, dto.amountUsd, dto.note);
  }

  /** Тот же лимит, что и у выдачи: это ровно так же деньги. */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Отобрать кредиты у магазина' })
  @ApiResponse({ status: 200, type: RevokeResultDto })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: RevokeCreditsDto,
  ): Promise<RevokeResultDto> {
    return this.credits.revoke(shopId, user.id, dto.credits, dto.note);
  }
}

/**
 * Предпросмотр начисления вынесен из маршрута магазина: сумма превращается в
 * кредиты по общему множителю и от конкретного магазина не зависит, а лишний
 * параметр пути ломал генерацию клиента.
 */
@ApiTags('credits-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/credits')
export class AdminCreditsPreviewController {
  constructor(private readonly credits: CreditsService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Сколько кредитов даст сумма' })
  @ApiResponse({ status: 200, type: CreditPreviewDto })
  preview(@Query('amountUsd') amountUsd: string): Promise<CreditPreviewDto> {
    const parsed = Number(amountUsd);
    return this.credits.preview(Number.isFinite(parsed) ? parsed : 0);
  }
}
