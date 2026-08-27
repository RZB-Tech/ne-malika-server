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
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { BannersService } from './banners.service';
import { BannerDto } from './dto/banner-response.dto';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';

@ApiTags('banners-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/banners')
export class AdminBannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @ApiOperation({ summary: 'Все баннеры, включая выключенные (администратор)' })
  @ApiOkResponse({ type: [BannerDto] })
  findAll() {
    return this.bannersService.findAllForAdmin();
  }

  @Post()
  @ApiOperation({ summary: 'Добавить баннер на главную' })
  @ApiResponse({ status: 201, type: BannerDto })
  create(@Body() dto: CreateBannerDto) {
    return this.bannersService.create(dto);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Задать порядок баннеров в карусели' })
  @ApiOkResponse({ type: [BannerDto] })
  @ApiResponse({ status: 400, description: 'Неизвестный или повторяющийся id' })
  reorder(@Body() dto: ReorderBannersDto) {
    return this.bannersService.reorder(dto.ids);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить баннер' })
  @ApiOkResponse({ type: BannerDto })
  @ApiResponse({ status: 404, description: 'Баннер не найден' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBannerDto) {
    return this.bannersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить баннер' })
  @ApiResponse({ status: 404, description: 'Баннер не найден' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.bannersService.remove(id);
  }
}
