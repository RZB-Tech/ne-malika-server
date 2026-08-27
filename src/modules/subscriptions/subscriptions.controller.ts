import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionPlanDto } from './dto/subscription.dto';

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
