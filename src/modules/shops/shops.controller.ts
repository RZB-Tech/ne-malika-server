import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ShopsService } from './shops.service';
import { FindPublicShopsQueryDto } from './dto/find-public-shops-query.dto';
import {
  PaginatedPublicShopsDto,
  ShopSitemapEntryDto,
} from './dto/public-shop.dto';

@ApiTags('shops-public')
@Public()
@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  @ApiOperation({
    summary: 'Каталог магазинов: только активные и только с товарами',
    description:
      'Магазины без единого активного товара в выдачу не попадают. Телефон ' +
      'в списке не отдаётся — он есть в карточке магазина, где раскрывается ' +
      'по нажатию и учитывается как контакт.',
  })
  @ApiResponse({ status: 200, type: PaginatedPublicShopsDto })
  findAll(@Query() query: FindPublicShopsQueryDto) {
    return this.shopsService.findPublicList(query);
  }

  @Get('sitemap')
  @ApiOperation({
    summary: 'id и дата изменения магазинов с товарами (для sitemap)',
  })
  @ApiResponse({ status: 200, type: [ShopSitemapEntryDto] })
  sitemap() {
    return this.shopsService.listPublicIds();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка магазина с его активными товарами' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Магазин найден' })
  @ApiResponse({ status: 404, description: 'Магазин не найден или упразднён' })
  getPublic(@Param('id', ParseIntPipe) id: number) {
    return this.shopsService.getPublicById(id);
  }
}
