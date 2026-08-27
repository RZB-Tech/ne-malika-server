import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionPlanDto } from './dto/subscription.dto';

/**
 * Публичный прайс тарифов.
 *
 * `@Public()`, а не `@SellerOnly()`: страницу «Стать продавцом» смотрят до
 * всякой регистрации, и требовать вход ради того, чтобы узнать цену, значит
 * прятать её от тех, кому она адресована. Ничего про конкретный магазин ручка
 * не возвращает — только то же, что написано на витрине.
 *
 * Отдельный контроллер, а не метод в кабинете продавца, по той же причине:
 * весь `seller/subscription` закрыт ролью целиком, и одна публичная ручка
 * внутри него потребовала бы снимать гвард поштучно.
 */
@ApiTags('subscriptions-public')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Тарифы подписки магазина и их цены' })
  @ApiResponse({ status: 200, type: [SubscriptionPlanDto] })
  plans(): SubscriptionPlanDto[] {
    return this.subscriptions.plans();
  }
}
