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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SubscriptionsService } from './subscriptions.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import {
  PaginatedSubscriptionPaymentsDto,
  PaymentLinkDto,
  SellerSubscriptionDto,
} from './dto/subscription.dto';

/**
 * Подписка глазами продавца.
 *
 * Идентификатор магазина ни в одну ручку не принимается: у продавца магазин
 * один (`shops_owner_unique_idx`), и параметр в пути пришлось бы проверять на
 * принадлежность — а однажды проверку бы забыли, и продавец оплатил бы чужой
 * магазин или прочитал чужой журнал платежей. Магазин выводится по владельцу,
 * и только активный.
 */
@ApiTags('subscriptions-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/subscription')
export class SellerSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Моя подписка: тариф, срок, кредиты и лимиты' })
  @ApiResponse({ status: 200, type: SellerSubscriptionDto })
  @ApiResponse({
    status: 403,
    description: 'У продавца нет активного магазина',
  })
  state(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SellerSubscriptionDto> {
    return this.subscriptions.stateForOwner(user.id);
  }

  /**
   * `@HttpCode(200)`, а не 201: ничего не создаётся — строка платежа появится
   * только когда провайдер пришлёт Prepare. Здесь лишь собирается ссылка.
   *
   * Лимит стоит потому, что это вход в кассу: ссылку открывают руками, десяти
   * попыток в минуту хватает любому живому человеку, а перебор тарифов в цикле
   * не нужен никому.
   */
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Получить ссылку на оплату тарифа' })
  @ApiResponse({ status: 200, type: PaymentLinkDto })
  @ApiResponse({
    status: 503,
    description: 'Приём оплаты не настроен — подписку выдаёт администратор',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutDto,
  ): Promise<PaymentLinkDto> {
    return this.subscriptions.checkout(user.id, dto.plan);
  }

  @Get('payments')
  @ApiOperation({ summary: 'История платежей за подписку' })
  @ApiResponse({ status: 200, type: PaginatedSubscriptionPaymentsDto })
  payments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedSubscriptionPaymentsDto> {
    return this.subscriptions.paymentsForOwner(user.id, query);
  }
}
