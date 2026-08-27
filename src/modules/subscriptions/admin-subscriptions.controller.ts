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

/**
 * Список подписок для администратора.
 *
 * Отдельным путём `admin/subscriptions`, а не разделом внутри `admin/shops`:
 * это другой предмет разговора. В магазинах администратор ищет магазин, здесь —
 * состояние оплаты: кто истекает на неделе, у кого платёж застрял, кого нужно
 * разобрать руками. Смешав их, пришлось бы либо тащить в список магазинов
 * четыре платёжных фильтра, либо заводить в нём режимы.
 */
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

/**
 * Действия над подпиской конкретного магазина.
 *
 * Второй контроллер, а не ещё несколько методов в первом: путь другой
 * (`admin/shops/:shopId/subscription`), и он намеренно повторяет уже
 * существующий `admin/shops/:shopId/credits` — администратор работает с
 * магазином, а подписка и кредиты у него рядом.
 */
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

  /**
   * Лимит здесь не от злоупотребления, а от двойного нажатия: каждая активация
   * выдаёт магазину месяц и норму кредитов. От повтора защищает ещё и минутное
   * окно в самом сервисе — лимит лишь не даёт добраться до него сотней запросов.
   */
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

  /**
   * Проверка кассы живыми деньгами.
   *
   * Открывает магазину окно на полчаса и отдаёт ссылку на кассу с
   * символической суммой. Успешная оплата ничего не выдаёт — она доказывает,
   * что подпись сходится, Prepare и Complete доходят и строка в журнале
   * появляется. Ради этого её и заводят: проверять боевой путь ценой тарифа
   * дорого, а проверять его на стенде без Click — значит не проверять.
   *
   * Тот же лимит, что у активации, и по той же причине: каждое нажатие
   * переоткрывает окно, а окно — это разрешение принять сумму мимо прайса.
   */
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

  /** Тот же лимит: отмена так же меняет деньги и права магазина. */
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
