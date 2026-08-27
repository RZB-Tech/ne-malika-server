import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { BannersService } from './banners.service';
import { BannerDto } from './dto/banner-response.dto';
import { CreateShopBannerDto } from './dto/create-shop-banner.dto';
import { UpdateShopBannerDto } from './dto/update-shop-banner.dto';

@ApiTags('banners-seller')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/banners')
export class SellerBannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @ApiOperation({
    summary: 'Баннеры своего магазина, включая ждущие модерации и отклонённые',
  })
  @ApiOkResponse({ type: [BannerDto] })
  @ApiResponse({ status: 404, description: 'Магазин не найден' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bannersService.findForShop(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Загрузить баннер на модерацию',
    description:
      'Баннер создаётся со статусом pending и попадёт в карусель только ' +
      'после одобрения администратором.',
  })
  @ApiResponse({ status: 201, type: BannerDto })
  @ApiResponse({ status: 400, description: 'Одна из картинок не загружена' })
  @ApiResponse({ status: 403, description: 'Тариф магазина не даёт баннер' })
  @ApiResponse({ status: 409, description: 'Все слоты баннеров заняты' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShopBannerDto,
  ) {
    return this.bannersService.createForShop(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Изменить свой баннер',
    description:
      'Любая правка возвращает баннер на модерацию: одобрена была картинка, ' +
      'а не строка в таблице.',
  })
  @ApiOkResponse({ type: BannerDto })
  @ApiResponse({ status: 400, description: 'Одна из картинок не загружена' })
  @ApiResponse({ status: 403, description: 'Тариф магазина не даёт баннер' })
  @ApiResponse({ status: 404, description: 'Баннер не найден' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShopBannerDto,
  ) {
    return this.bannersService.updateOwn(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить свой баннер' })
  @ApiResponse({ status: 404, description: 'Баннер не найден' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.bannersService.removeOwn(user.id, id);
  }
}
