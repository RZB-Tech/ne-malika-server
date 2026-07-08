import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { AiService } from './ai.service';
import { ProductCardsService } from '../product-cards/product-cards.service';

@ApiTags('product-cards-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/product-cards')
export class SellerAiChecksController {
  constructor(
    private readonly aiService: AiService,
    private readonly productCardsService: ProductCardsService,
  ) {}

  @Get(':id/ai-check')
  @ApiOperation({
    summary: 'Результат последней ИИ-проверки своей карточки товара',
  })
  @ApiResponse({
    status: 404,
    description:
      'Товар не найден, не принадлежит вам, или проверка ещё не выполнялась',
  })
  async getCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    // Проверка владения — переиспользуем существующий метод, кидает 404,
    // если товар чужой или не существует.
    await this.productCardsService.getOwnOrThrow(user.id, id);
    const check = await this.aiService.getLatestCheck(id);
    return check ?? { verdict: null, message: 'Проверка ещё не выполнялась' };
  }
}
