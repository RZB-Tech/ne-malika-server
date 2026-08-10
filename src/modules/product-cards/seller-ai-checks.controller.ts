import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  /** Лимит здесь свой: каждая отправка — платный запрос к модели. */
  @Post(':id/recheck')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Отправить свой товар на повторную ИИ-проверку' })
  recheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.productCardsService.recheckOwn(user.id, id);
  }
}
