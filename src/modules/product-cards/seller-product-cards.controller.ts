import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { ProductCardsService } from './product-cards.service';
import { CreateProductCardDto } from './dto/create-product-card.dto';
import { UpdateProductCardDto } from './dto/update-product-card.dto';

@ApiTags('product-cards-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller')
export class SellerProductCardsController {
  constructor(private readonly productCardsService: ProductCardsService) {}

  @Get('shops/:shopId/product-cards')
  @ApiOperation({
    summary: 'Список товаров своего магазина (включая упразднённые)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    return this.productCardsService.listForSeller(user.id, shopId);
  }

  @Post('shops/:shopId/product-cards')
  @ApiOperation({ summary: 'Создать товар в своём магазине' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: CreateProductCardDto,
  ) {
    return this.productCardsService.createForSeller(user.id, shopId, dto);
  }

  @Put('product-cards/:id')
  @ApiOperation({ summary: 'Обновить свой товар' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductCardDto,
  ) {
    return this.productCardsService.updateOwn(user.id, id, dto);
  }

  @Delete('product-cards/:id')
  @ApiOperation({ summary: 'Удалить свой товар' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.productCardsService.removeOwn(user.id, id);
  }
}
