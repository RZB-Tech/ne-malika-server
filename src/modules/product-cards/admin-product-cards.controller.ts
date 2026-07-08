import { Body, Controller, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { ProductCardsService } from './product-cards.service';
import { AbolishProductCardDto } from './dto/abolish-product-card.dto';

@ApiTags('product-cards-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/product-cards')
export class AdminProductCardsController {
  constructor(private readonly productCardsService: ProductCardsService) {}

  @Patch(':id/abolish')
  @ApiOperation({ summary: 'Упразднить товар с обязательной причиной' })
  abolish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AbolishProductCardDto,
  ) {
    return this.productCardsService.adminAbolish(id, dto.reason);
  }

  @Patch(':id/restore')
  @ApiOperation({
    summary:
      'Вернуть товар, автоматически скрытый ИИ-проверкой, в публичную выдачу',
  })
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.productCardsService.adminRestore(id);
  }
}
