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
