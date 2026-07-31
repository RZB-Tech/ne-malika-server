import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { AiChecksService } from '../ai/ai-checks.service';
import { ProductCardsService } from './product-cards.service';

@ApiTags('product-cards-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/product-cards')
export class SellerAiChecksController {
  constructor(
    private readonly aiChecksService: AiChecksService,
    private readonly productCardsService: ProductCardsService,
  ) {}

  @Get(':id/ai-check')
  @ApiOperation({ summary: 'Результат последней ИИ-проверки своего товара' })
  async getCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.productCardsService.getOwnOrThrow(user.id, id);
    const check = await this.aiChecksService.getLatestFor(id);
    return check ?? { message: 'Проверка ещё не выполнялась' };
  }
}
