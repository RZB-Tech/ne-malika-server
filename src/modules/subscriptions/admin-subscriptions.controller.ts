import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ReasonDto } from '../../common/dto/reason.dto';
import { SubscriptionsService } from './subscriptions.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { FindAdminSubscriptionsQueryDto } from './dto/find-admin-subscriptions-query.dto';
import {
  PaginatedAdminSubscriptionsDto,
  PaginatedSubscriptionPaymentsDto,
  SellerSubscriptionDto,
  TestPaymentLinkDto,
} from './dto/subscription.dto';

@ApiTags('subscriptions-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Подписки магазинов: тариф, срок и флаги ручного разбора',
  })
  @ApiResponse({ status: 200, type: PaginatedAdminSubscriptionsDto })
  list(
    @Query() query: FindAdminSubscriptionsQueryDto,
  ): Promise<PaginatedAdminSubscriptionsDto> {
    return this.subscriptions.adminList(query);
  }
}

@ApiTags('subscriptions-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/shops/:shopId/subscription')
export class AdminShopSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('payments')
  @ApiOperation({ summary: 'Платежи магазина за подписку' })
  @ApiResponse({ status: 200, type: PaginatedSubscriptionPaymentsDto })
  payments(
    @Param('shopId', ParseIntPipe) shopId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedSubscriptionPaymentsDto> {
    return this.subscriptions.payments(shopId, query);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Выдать подписку вручную' })
  @ApiResponse({ status: 200, type: SellerSubscriptionDto })
  @ApiResponse({
    status: 409,
    description: 'Магазин упразднён либо подписка уже выдана только что',
  })
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: ActivateSubscriptionDto,
  ): Promise<SellerSubscriptionDto> {
    return this.subscriptions.adminActivate(shopId, user.id, dto);
  }

  @Post('test-checkout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Открыть окно тестовой оплаты и выдать ссылку' })
  @ApiResponse({ status: 200, type: TestPaymentLinkDto })
  @ApiResponse({ status: 400, description: 'Тестовая сумма не задана' })
  @ApiResponse({ status: 404, description: 'Активный магазин не найден' })
  @ApiResponse({ status: 503, description: 'Click не настроен' })
  testCheckout(
    @Param('shopId', ParseIntPipe) shopId: number,
  ): Promise<TestPaymentLinkDto> {
    return this.subscriptions.armTestCheckout(shopId);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Оборвать оплаченный период досрочно' })
  @ApiResponse({ status: 200, type: SellerSubscriptionDto })
  @ApiResponse({
    status: 409,
    description: 'У магазина нет действующей подписки',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: ReasonDto,
  ): Promise<SellerSubscriptionDto> {
    return this.subscriptions.adminCancel(shopId, user.id, dto.reason);
  }
}
