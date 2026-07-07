import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ProductCardsService } from './product-cards.service';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';

@ApiTags('product-cards-public')
@Controller('product-cards')
export class ProductCardsController {
  constructor(private readonly productCardsService: ProductCardsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Список товаров с фильтрами, поиском и пагинацией' })
  findAll(@Query() query: FindProductCardsQueryDto) {
    return this.productCardsService.findPublicList(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Карточка товара' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Товар не найден или упразднён' })
  getPublic(@Param('id', ParseIntPipe) id: number) {
    return this.productCardsService.getPublicById(id);
  }
}
