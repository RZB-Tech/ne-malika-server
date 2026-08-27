import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreditsService } from './credits.service';
import {
  PaginatedCreditsHistoryDto,
  SellerCreditsDto,
} from './dto/credits.dto';

@ApiTags('credits-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/credits')
export class SellerCreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @ApiOperation({ summary: 'Мои кредиты: купленные и подписочные' })
  @ApiResponse({ status: 200, type: SellerCreditsDto })
  @ApiResponse({
    status: 404,
    description: 'У продавца нет активного магазина',
  })
  async balance(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SellerCreditsDto> {
    const state = await this.credits.balance(await this.shopIdOf(user));
    if (!state) throw new NotFoundException('Магазин не найден');
    return {
      balance: state.balance,
      reserved: state.reserved,
      subscription: state.subscription,
      usable: state.usable,
      available: Math.max(0, state.available),
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'История начислений, списаний и сгораний' })
  @ApiResponse({ status: 200, type: PaginatedCreditsHistoryDto })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedCreditsHistoryDto> {
    return this.credits.historyForSeller(await this.shopIdOf(user), query);
  }

  private async shopIdOf(user: AuthenticatedUser): Promise<number> {
    const shopId = await this.credits.shopIdOf(user.id);
    if (!shopId) throw new NotFoundException('Магазин не найден');
    return shopId;
  }
}
