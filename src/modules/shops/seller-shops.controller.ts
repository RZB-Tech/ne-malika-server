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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { ShopsService } from './shops.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';

@ApiTags('shops-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/shops')
export class SellerShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  @ApiOperation({ summary: 'Список собственных магазинов' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.listOwn(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать магазин' })
  @ApiResponse({ status: 201, description: 'Магазин создан' })
  @ApiResponse({
    status: 400,
    description: 'Не указан контакт/telegram_link и нет значения по умолчанию',
  })
  @ApiResponse({
    status: 409,
    description: 'У пользователя уже есть магазин',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShopDto) {
    return this.shopsService.createForSeller(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить свой магазин по id' })
  @ApiResponse({
    status: 404,
    description: 'Магазин не найден или не принадлежит вам',
  })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shopsService.getOwnOrThrow(user.id, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Обновить свой магазин' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShopDto,
  ) {
    return this.shopsService.updateOwn(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Удалить свой магазин (каскадно удаляет его товары)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shopsService.removeOwn(user.id, id);
  }
}
