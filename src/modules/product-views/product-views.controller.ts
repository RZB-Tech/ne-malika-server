import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductViewsService } from './product-views.service';
import { RecordProductViewDto } from './dto/record-product-view.dto';
import { SyncProductViewsDto } from './dto/sync-product-views.dto';
import { PaginatedProductViewsDto } from './dto/product-view.dto';

@ApiTags('me-product-views')
@ApiBearerAuth('access-token')
@Controller('me/product-views')
export class ProductViewsController {
  constructor(private readonly productViewsService: ProductViewsService) {}

  @Get()
  @ApiOperation({ summary: 'История просмотров, свежие сверху' })
  @ApiResponse({ status: 200, type: PaginatedProductViewsDto })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.productViewsService.findMine(user.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отметить просмотр карточки товара' })
  @ApiResponse({ status: 404, description: 'Товар не найден или недоступен' })
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordProductViewDto,
  ) {
    return this.productViewsService.record(user.id, dto.product_card_id);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Перенести историю, накопленную до входа (localStorage)',
  })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncProductViewsDto,
  ) {
    return this.productViewsService.sync(user.id, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Очистить историю целиком' })
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.productViewsService.clear(user.id);
  }

  @Delete(':productCardId')
  @ApiOperation({ summary: 'Убрать один товар из истории' })
  @ApiResponse({ status: 404, description: 'Товара нет в истории' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productCardId', ParseIntPipe) productCardId: number,
  ) {
    return this.productViewsService.remove(user.id, productCardId);
  }
}
