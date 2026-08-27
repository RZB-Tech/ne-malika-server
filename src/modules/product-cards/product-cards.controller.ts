import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ProductCardsService } from './product-cards.service';
import { FindProductCardsQueryDto } from './dto/find-product-cards-query.dto';

@ApiTags('product-cards-public')
@Public()
@Controller('product-cards')
export class ProductCardsController {
  constructor(private readonly productCardsService: ProductCardsService) {}

  /**
   * `user-agent` берём заголовком в подписи метода, а не через параметр-декоратор:
   * это тот же приём, что в `ProductStatsController`, и попадание заголовка в
   * OpenAPI здесь безвредно — сгенерированный клиент его не отправляет, а
   * браузер проставляет сам. Нужен он ровно для одного: отсеять роботов, чтобы
   * обход поисковика не приезжал продавцу как интерес покупателей.
   *
   * Подпись посетителя, наоборот, приходит полем запроса (`visitor_id`):
   * заголовков, которые клиент мог бы проставить сам, у нас нет, а
   * `app.set('trust proxy')` не выставлен — за nginx `req.ip` одинаков у всех
   * и для дедупликации не годится.
   */
  @Get()
  @ApiOperation({ summary: 'Список товаров с фильтрами, поиском и пагинацией' })
  findAll(
    @Query() query: FindProductCardsQueryDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.productCardsService.findPublicList(query, userAgent);
  }

  @Get('sitemap')
  @ApiOperation({
    summary: 'id и дата изменения всех активных товаров (для sitemap)',
  })
  sitemap() {
    return this.productCardsService.listPublicIds();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка товара' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Товар не найден или упразднён' })
  getPublic(@Param('id', ParseIntPipe) id: number) {
    return this.productCardsService.getPublicById(id);
  }
}
