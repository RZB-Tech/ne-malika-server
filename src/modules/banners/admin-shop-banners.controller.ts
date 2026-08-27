import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { BannersService } from './banners.service';
import {
  AdminBannerDto,
  PaginatedShopBannersDto,
} from './dto/banner-response.dto';
import { FindShopBannersQueryDto } from './dto/find-shop-banners-query.dto';
import { ModerateBannerDto } from './dto/moderate-banner.dto';

@ApiTags('banners-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/shop-banners')
export class AdminShopBannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @ApiOperation({ summary: 'Баннеры продавцов: очередь модерации и архив' })
  @ApiOkResponse({ type: PaginatedShopBannersDto })
  list(@Query() query: FindShopBannersQueryDto) {
    return this.bannersService.findShopBannersForAdmin(query);
  }

  @Patch(':id/moderate')
  @ApiOperation({
    summary: 'Одобрить или отклонить баннер продавца',
    description:
      'При отказе причина обязательна — её читает продавец. О решении ' +
      'владелец магазина узнаёт в Telegram и push-уведомлением.',
  })
  @ApiOkResponse({ type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'Отказ без причины' })
  @ApiResponse({ status: 404, description: 'Баннер не найден' })
  moderate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModerateBannerDto,
  ) {
    return this.bannersService.moderate(id, dto, admin.id);
  }
}
