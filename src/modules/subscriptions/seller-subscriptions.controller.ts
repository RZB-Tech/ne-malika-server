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
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SubscriptionsService } from './subscriptions.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import {
  CreateInvoiceDto,
  InvoiceDto,
  PaginatedSubscriptionPaymentsDto,
  PaymentLinkDto,
  SellerSubscriptionDto,
} from './dto/subscription.dto';

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
    return this.subscriptions.checkout(user.id, dto.plan, dto.provider);
  }

  @Post('invoice')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Выставить счёт на номер телефона' })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 400, description: 'Неверный номер телефона' })
  @ApiResponse({ status: 503, description: 'Merchant API не настроен' })
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceDto,
  ): Promise<InvoiceDto> {
    return this.subscriptions.createInvoice(user.id, dto.plan, dto.phone);
  }

  @Get('invoice/:orderId')
  @ApiOperation({ summary: 'Состояние выставленного счёта' })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 404, description: 'Счёт не найден' })
  invoiceState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<InvoiceDto> {
    return this.subscriptions.invoiceState(user.id, orderId);
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
