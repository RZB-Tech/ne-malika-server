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

/**
 * Кредиты глазами продавца (V11).
 *
 * До подписок весь журнал кредитов был закрыт `@AdminOnly()`, и продавец видел
 * только одно число — остаток в углу формы. С двумя карманами этого стало
 * категорически мало: подписочные кредиты сгорают при следующей оплате, и
 * человек, у которого «было 6000, стало 3000», обязан иметь возможность
 * увидеть, что 1200 сожгла выдача новой нормы, а не списание за генерацию.
 * Обещанная прозрачность сгорания без этих двух ручек просто не существует.
 *
 * Магазин выводится по владельцу и только активный — тот же фильтр, что у
 * резерва кредитов. Идентификатор магазина в пути не принимается вовсе: у
 * продавца он один, а параметр в пути пришлось бы проверять на принадлежность,
 * и однажды проверку бы забыли.
 */
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

  /**
   * Магазин продавца. Отсутствие магазина — 404, а не пустой ответ: роль
   * `seller` без активного магазина означает, что магазин упразднён, и
   * показывать по нему остаток кредитов как ни в чём не бывало нельзя.
   */
  private async shopIdOf(user: AuthenticatedUser): Promise<number> {
    const shopId = await this.credits.shopIdOf(user.id);
    if (!shopId) throw new NotFoundException('Магазин не найден');
    return shopId;
  }
}
